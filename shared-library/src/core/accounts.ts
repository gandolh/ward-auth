import {
  foldUsername,
  generateSessionToken,
  generateUserId,
  hashSessionToken,
  isAcceptableUserId,
  normaliseUsername,
} from "./identifiers.js";
import { hashPassword, passwordPolicyError, spendDummyHash, verifyPassword } from "./password.js";
import type { AuthStore, SessionOrigin, SessionRecord, UserRecord } from "../store/types.js";

/**
 * Local accounts and sessions, framework-free.
 *
 * Everything with a rule in it lives here — who may sign in, how long a
 * session lasts, which sessions a password change ends — so the Fastify plugin
 * is only HTTP plumbing, and a later NestJS adapter (imbatranimOS was kept
 * possible, see decisions-oidc.md) would reuse all of it.
 *
 * ## Session lifetimes
 *
 * - **Idle: 14 days.** A session nobody uses for two weeks ends. Long enough
 *   that a personal app opened every weekend never asks for a password; short
 *   enough that a forgotten device stops being signed in on its own.
 * - **Absolute: 30 days.** No session outlives this, however active. It is the
 *   same ceiling as Ward's refresh family (decisions-tokens.md), so a
 *   Ward-originated session and a local one age out on the same clock.
 * - **Renewal at most once an hour.** The sliding expiry is pushed out — and
 *   the cookie re-sent — only when the last renewal is an hour old. A write on
 *   every authenticated request would turn page loads into database writes for
 *   nothing; an hour of slack on a 14-day idle timeout is invisible.
 */

/** A session ends after this long without a request. */
export const SESSION_IDLE_SECONDS = 14 * 24 * 60 * 60;

/** No session outlives this, however active. Ward's refresh-family ceiling. */
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;

/** The sliding expiry is written at most this often per session. */
export const SESSION_RENEW_INTERVAL_SECONDS = 60 * 60;

/** A user as the app and the browser see it. Never carries the hash. */
export interface AuthUser {
  id: string;
  username: string;
  role: string;
  /** False for a user created by a Ward sign-in who has not set a local password. */
  hasPassword: boolean;
}

/** A live, resolved session. */
export interface ResolvedSession {
  user: AuthUser;
  session: SessionRecord;
  /**
   * True when this resolution pushed the expiry out. The HTTP layer re-sends
   * the cookie with the new `Max-Age` exactly then.
   */
  renewed: boolean;
}

export interface NewUserInput {
  username: string;
  /** Omit or `null` for a user with no local password (a Ward-created user). */
  password?: string | null;
  role: string;
  /**
   * Only when migrating rows that already have keys — briefs 22 and 24 pass
   * each user's Ward subject. Ordinary creation omits it.
   */
  id?: string;
}

export interface StartSessionOptions {
  /** Defaults to `"local"`. */
  origin?: SessionOrigin;
  /** Required exactly when `origin` is `"ward"`. Brief 21 passes it. */
  wardSid?: string | null;
}

export interface Accounts {
  readonly store: AuthStore;
  /**
   * Create a user. Throws `UsernamePolicyError`, `PasswordPolicyError`,
   * `UsernameTakenError`, `UserIdTakenError`, or `InvalidUserIdError`.
   */
  createUser(input: NewUserInput): Promise<AuthUser>;
  findUserById(id: string): Promise<AuthUser | undefined>;
  findUserByUsername(username: string): Promise<AuthUser | undefined>;
  setRole(userId: string, role: string): Promise<void>;
  /**
   * The password check. `undefined` for an unknown username, a user with no
   * local password, or a wrong password — **one answer, one cost**: every path
   * runs scrypt once, so timing does not reveal which accounts exist.
   */
  verifyCredentials(username: string, password: string): Promise<AuthUser | undefined>;
  /**
   * Change a password given the current one. Returns `false` for a wrong
   * current password (including a user with none). On success **ends every
   * other session the user holds** — the point of changing a password after a
   * leak — and keeps `keepSessionIdHash`, the one the change came from.
   * Throws `PasswordPolicyError` for a bad new password, before any hashing.
   */
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionIdHash?: string,
  ): Promise<boolean>;
  /**
   * Set a password with no current-password check, ending every other
   * session. For the seed script and brief 21's "set a local password"; a
   * route must establish who is asking before calling it.
   */
  setPassword(userId: string, newPassword: string, keepSessionIdHash?: string): Promise<void>;
  /** Mint a session. The token is the cookie value and is not stored. */
  startSession(
    userId: string,
    options?: StartSessionOptions,
  ): Promise<{ token: string; session: SessionRecord }>;
  /**
   * The session a cookie value names, renewing its sliding expiry when due.
   * `undefined` when there is none, it expired, or its user is gone. An
   * expired row is deleted on sight.
   */
  resolveSession(token: string | undefined): Promise<ResolvedSession | undefined>;
  /** End one session by its cookie value. Unknown tokens are a no-op. */
  endSession(token: string): Promise<void>;
  /** End one session by its stored hash (the guard's extension hook uses this). */
  endSessionByIdHash(idHash: string): Promise<void>;
  /** Housekeeping. The plugin calls it on each successful login. */
  deleteExpiredSessions(): Promise<number>;
}

export interface AccountsOptions {
  store: AuthStore;
  /** Epoch milliseconds. Injected by tests; `Date.now` otherwise. */
  now?: () => number;
}

/** Thrown for an app-supplied user id the library will not store. */
export class InvalidUserIdError extends Error {
  readonly code = "invalid_user_id" as const;
  constructor() {
    super("user id must be 1 to 128 printable ASCII characters with no spaces");
    this.name = "InvalidUserIdError";
  }
}

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    hasPassword: user.passwordHash !== null,
  };
}

export function createAccounts(options: AccountsOptions): Accounts {
  const { store } = options;
  const now = options.now ?? (() => Date.now());

  async function createUser(input: NewUserInput): Promise<AuthUser> {
    const username = normaliseUsername(input.username);
    if (input.id !== undefined && !isAcceptableUserId(input.id)) throw new InvalidUserIdError();
    if (typeof input.role !== "string" || input.role.length === 0) {
      throw new TypeError("createUser: role must be a non-empty string");
    }

    const passwordHash =
      input.password === undefined || input.password === null
        ? null
        : await hashPassword(input.password);

    const created = await store.createUser({
      id: input.id ?? generateUserId(),
      username,
      usernameFolded: foldUsername(username),
      passwordHash,
      role: input.role,
      createdAt: now(),
    });
    return toAuthUser(created);
  }

  async function verifyCredentials(
    username: string,
    password: string,
  ): Promise<AuthUser | undefined> {
    const user = await store.findUserByFoldedUsername(foldUsername(username));

    // The unknown-username branch and the no-local-password branch both spend
    // a hash. Without it this answers in under a millisecond for a name that
    // does not exist and in ~50 ms for one that does: an account-enumeration
    // oracle that needs no error message and leaves nothing in a log.
    const ok =
      user === undefined || user.passwordHash === null
        ? await spendDummyHash(password)
        : await verifyPassword(password, user.passwordHash);

    // `user === undefined` is repeated rather than inferred from `ok`, so a
    // future edit that makes the dummy path succeed cannot type-check its way
    // into a sign-in.
    if (user === undefined || !ok) return undefined;
    return toAuthUser(user);
  }

  async function changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionIdHash?: string,
  ): Promise<boolean> {
    const policy = passwordPolicyError(newPassword);
    if (policy !== undefined) throw policy;

    const user = await store.findUserById(userId);
    const ok =
      user === undefined || user.passwordHash === null
        ? await spendDummyHash(currentPassword)
        : await verifyPassword(currentPassword, user.passwordHash);
    if (user === undefined || !ok) return false;

    await setPassword(userId, newPassword, keepSessionIdHash);
    return true;
  }

  async function setPassword(
    userId: string,
    newPassword: string,
    keepSessionIdHash?: string,
  ): Promise<void> {
    const hash = await hashPassword(newPassword);
    await store.setPasswordHash(userId, hash, now());
    await store.deleteUserSessions(userId, keepSessionIdHash);
  }

  async function startSession(
    userId: string,
    sessionOptions: StartSessionOptions = {},
  ): Promise<{ token: string; session: SessionRecord }> {
    const origin = sessionOptions.origin ?? "local";
    const wardSid = sessionOptions.wardSid ?? null;
    if ((origin === "ward") !== (wardSid !== null)) {
      throw new TypeError("startSession: wardSid is required for a Ward session and only for one");
    }

    const token = generateSessionToken();
    const at = now();
    const session: SessionRecord = {
      idHash: hashSessionToken(token),
      userId,
      origin,
      wardSid,
      createdAt: at,
      renewedAt: at,
      expiresAt: at + SESSION_IDLE_SECONDS * 1000,
    };
    await store.createSession(session);
    return { token, session };
  }

  async function resolveSession(token: string | undefined): Promise<ResolvedSession | undefined> {
    if (token === undefined || token.length === 0) return undefined;

    const idHash = hashSessionToken(token);
    const session = await store.findSession(idHash);
    if (session === undefined) return undefined;

    const at = now();
    if (session.expiresAt <= at) {
      await store.deleteSession(idHash);
      return undefined;
    }

    const user = await store.findUserById(session.userId);
    if (user === undefined) {
      await store.deleteSession(idHash);
      return undefined;
    }

    if (at - session.renewedAt < SESSION_RENEW_INTERVAL_SECONDS * 1000) {
      return { user: toAuthUser(user), session, renewed: false };
    }

    const ceiling = session.createdAt + SESSION_ABSOLUTE_SECONDS * 1000;
    const expiresAt = Math.min(at + SESSION_IDLE_SECONDS * 1000, ceiling);
    if (expiresAt <= session.expiresAt) {
      // Already at the absolute ceiling: nothing to push out, nothing to write.
      return { user: toAuthUser(user), session, renewed: false };
    }

    await store.renewSession(idHash, at, expiresAt);
    return {
      user: toAuthUser(user),
      session: { ...session, renewedAt: at, expiresAt },
      renewed: true,
    };
  }

  return {
    store,
    createUser,
    async findUserById(id) {
      const user = await store.findUserById(id);
      return user === undefined ? undefined : toAuthUser(user);
    },
    async findUserByUsername(username) {
      const user = await store.findUserByFoldedUsername(foldUsername(username));
      return user === undefined ? undefined : toAuthUser(user);
    },
    async setRole(userId, role) {
      if (role.length === 0) throw new TypeError("setRole: role must be a non-empty string");
      await store.setRole(userId, role, now());
    },
    verifyCredentials,
    changePassword,
    setPassword,
    startSession,
    resolveSession,
    async endSession(token) {
      await store.deleteSession(hashSessionToken(token));
    },
    async endSessionByIdHash(idHash) {
      await store.deleteSession(idHash);
    },
    async deleteExpiredSessions() {
      return store.deleteExpiredSessions(now());
    },
  };
}

/** One user for `seedUsers`. */
export interface SeedUser {
  username: string;
  password: string;
  role: string;
  id?: string;
}

export interface SeedResult {
  /** Usernames created by this run. */
  created: string[];
  /** Usernames that already existed and were left exactly as they were. */
  existing: string[];
}

/**
 * Create each user that does not exist yet; leave every existing one alone.
 *
 * Idempotent, so an app's seed script can run on every deploy. It never
 * resets a password or a role: a seed that overwrote them would undo whatever
 * the person changed since, every time it ran. The passwords come from the
 * app's environment or a prompt, never from a file in the repo.
 */
export async function seedUsers(
  accounts: Accounts,
  users: readonly SeedUser[],
): Promise<SeedResult> {
  const result: SeedResult = { created: [], existing: [] };
  for (const user of users) {
    if ((await accounts.findUserByUsername(user.username)) !== undefined) {
      result.existing.push(user.username);
      continue;
    }
    await accounts.createUser(user);
    result.created.push(user.username);
  }
  return result;
}
