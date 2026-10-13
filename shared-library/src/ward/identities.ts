import { InvalidUserIdError, toAuthUser, type Accounts, type AuthUser } from "../core/accounts.js";
import {
  MAX_USERNAME_LENGTH,
  UsernamePolicyError,
  foldUsername,
  generateUserId,
  isAcceptableUserId,
  normaliseUsername,
} from "../core/identifiers.js";
import { hashPassword } from "../core/password.js";
import {
  UsernameTakenError,
  WardSubjectTakenError,
  isWardAuthStore,
  type WardAuthStore,
} from "../store/types.js";
import type { WardClient, WardIdentity } from "./client.js";

/**
 * Local users and Ward accounts: who a Ward sign-in is, and the links.
 *
 * ## The rules (decisions-oidc.md)
 *
 * A Ward sign-in resolves to a local user in exactly one way:
 *
 * 1. a user **linked** to that Ward subject signs in;
 * 2. otherwise, in link mode, the signed-in user who started the flow from
 *    their settings gets linked (the plugin does this, with `link`);
 * 3. otherwise a **new** local user is created, linked to the subject, named
 *    from `preferred_username` (suffixed if the name is taken) and holding the
 *    role the grant names.
 *
 * **Never by username.** A local `alice` and a Ward `alice` are strangers
 * until alice links them herself. On a shared origin anything else is account
 * takeover: whoever controls the Ward account named `alice` would walk into
 * the local one.
 *
 * After creation the local row owns the role. Ward's grant decides whether a
 * Ward account may get in at all; what it may do inside is the app's.
 */

/** Thrown by `unlink` for a user with no local password: unlinking would lock them out. */
export class NoLocalPasswordError extends Error {
  readonly code = "no_local_password" as const;
  constructor() {
    super("set a local password before unlinking Ward");
    this.name = "NoLocalPasswordError";
  }
}

/** Thrown by `unlink` (and the reauthentication flow) for a user with no Ward link. */
export class NotLinkedError extends Error {
  readonly code = "not_linked" as const;
  constructor() {
    super("this user has no Ward account linked");
    this.name = "NotLinkedError";
  }
}

export interface NewLinkedUserInput {
  /** The Ward subject to link. */
  subject: string;
  username: string;
  role: string;
  /** Omit for a user who signs in with Ward only (until they set a password). */
  password?: string | null;
  /**
   * The local id. **Pass the subject itself when migrating** an app whose own
   * rows are keyed by Ward subjects, so every existing row keeps pointing at
   * the right person. Minted otherwise.
   */
  id?: string;
}

export interface WardIdentities {
  readonly accounts: Accounts;
  findUserBySubject(subject: string): Promise<AuthUser | undefined>;
  /** The Ward subject linked to a local user, if any. */
  subjectOf(userId: string): Promise<string | undefined>;
  /**
   * Create a local user already linked to a Ward subject, in one transaction.
   * The migration path and the seed's tool; the sign-in creates its users
   * through `userForSignIn`. Throws `UsernameTakenError`, `UserIdTakenError`,
   * `WardSubjectTakenError`, and the policy errors `createUser` throws.
   */
  createLinkedUser(input: NewLinkedUserInput): Promise<AuthUser>;
  /**
   * The user a verified Ward sign-in is: the linked one, or a new one (rule
   * 3). Never matches by username.
   */
  userForSignIn(
    identity: WardIdentity,
    roleFor?: (wardRole: string) => string,
  ): Promise<{ user: AuthUser; created: boolean }>;
  /**
   * Link a Ward subject to an existing user. Only ever called for the user
   * who is signed in and started the link from their own settings. Linking
   * the same pair twice is a no-op. Throws `AlreadyLinkedError` (the user has
   * another Ward account linked) or `WardSubjectTakenError` (that Ward account
   * belongs to someone else here).
   */
  link(userId: string, subject: string): Promise<void>;
  /**
   * Remove the user's link and end every Ward-originated session they hold.
   * Refused (`NoLocalPasswordError`) while the user has no local password;
   * `NotLinkedError` when there is nothing to unlink.
   */
  unlink(userId: string): Promise<{ endedSessions: number }>;
  /**
   * Mail a user through Ward. Only linked users have an address Ward knows;
   * an unlinked one gets `{ sent: false, reason: "not_linked" }` without a
   * call. Throws what `WardClient.sendNotification` throws.
   */
  notifyUser(
    client: WardClient,
    userId: string,
    message: { mailSubject: string; text: string },
  ): Promise<{ sent: boolean; reason?: "not_linked" }>;
}

export interface WardIdentitiesOptions {
  accounts: Accounts;
  /** Epoch milliseconds. Must match the one `accounts` uses. */
  now?: () => number;
}

/** The highest numeric suffix tried before falling back to a random one. */
const MAX_NAME_SUFFIX = 99;

export function createWardIdentities(options: WardIdentitiesOptions): WardIdentities {
  const { accounts } = options;
  const now = options.now ?? (() => Date.now());
  if (!isWardAuthStore(accounts.store)) {
    throw new TypeError(
      "createWardIdentities: the accounts' store has no Ward link methods. " +
        "createSqliteStore provides them; a custom store must implement WardAuthStore.",
    );
  }
  const store: WardAuthStore = accounts.store;

  async function findUserBySubject(subject: string): Promise<AuthUser | undefined> {
    const link = await store.findWardLinkBySubject(subject);
    return link === undefined ? undefined : accounts.findUserById(link.userId);
  }

  async function createLinkedUser(input: NewLinkedUserInput): Promise<AuthUser> {
    const username = normaliseUsername(input.username);
    if (input.id !== undefined && !isAcceptableUserId(input.id)) throw new InvalidUserIdError();
    if (typeof input.role !== "string" || input.role.length === 0) {
      throw new TypeError("createLinkedUser: role must be a non-empty string");
    }
    if (typeof input.subject !== "string" || input.subject.length === 0) {
      throw new TypeError("createLinkedUser: subject must be a non-empty string");
    }
    const passwordHash =
      input.password === undefined || input.password === null
        ? null
        : await hashPassword(input.password);

    const created = await store.createUserWithWardLink(
      {
        id: input.id ?? generateUserId(),
        username,
        usernameFolded: foldUsername(username),
        passwordHash,
        role: input.role,
        createdAt: now(),
      },
      input.subject,
    );
    return toAuthUser(created);
  }

  async function userForSignIn(
    identity: WardIdentity,
    roleFor: (wardRole: string) => string = (role) => role,
  ): Promise<{ user: AuthUser; created: boolean }> {
    const linked = await findUserBySubject(identity.subject);
    if (linked !== undefined) return { user: linked, created: false };

    const role = roleFor(identity.role);
    for (const username of candidateUsernames(identity.username)) {
      try {
        const user = await createLinkedUser({ subject: identity.subject, username, role });
        return { user, created: true };
      } catch (error) {
        if (error instanceof UsernameTakenError) continue;
        if (error instanceof WardSubjectTakenError) {
          // Two first sign-ins for one subject raced; the other one won.
          const winner = await findUserBySubject(identity.subject);
          if (winner !== undefined) return { user: winner, created: false };
        }
        throw error;
      }
    }
    throw new Error("could not find a free username for a new Ward user");
  }

  return {
    accounts,
    findUserBySubject,
    async subjectOf(userId) {
      return (await store.findWardLinkByUserId(userId))?.subject;
    },
    createLinkedUser,
    userForSignIn,

    async link(userId, subject) {
      const existing = await store.findWardLinkByUserId(userId);
      if (existing !== undefined && existing.subject === subject) return;
      await store.createWardLink({ subject, userId, linkedAt: now() });
    },

    async unlink(userId) {
      const user = await accounts.findUserById(userId);
      if (user === undefined || (await store.findWardLinkByUserId(userId)) === undefined) {
        throw new NotLinkedError();
      }
      if (!user.hasPassword) throw new NoLocalPasswordError();
      await store.deleteWardLink(userId);
      // A session that began with Ward is tied to the link: without it there
      // is no subject to ask Ward about, and no revoke-everywhere.
      const endedSessions = await store.deleteUserWardSessions(userId);
      return { endedSessions };
    },

    async notifyUser(client, userId, message) {
      const subject = (await store.findWardLinkByUserId(userId))?.subject;
      if (subject === undefined) return { sent: false, reason: "not_linked" };
      return client.sendNotification({ subject, ...message });
    },
  };
}

/** The name a Ward user gets when `preferred_username` cannot be used. */
const FALLBACK_USERNAME = "ward-user";

/**
 * Names to try for a new Ward user: `preferred_username` as Ward has it, then
 * `name-2`, `name-3`, …, then a random suffix, then `ward-user-<random>`. A
 * name that fails the local policy (Ward's rules are not this library's)
 * falls back to `ward-user`. Every name yielded passes the policy, so a
 * strange `preferred_username` can cost a person their preferred name, never
 * their sign-in.
 */
function* candidateUsernames(preferred: string): Generator<string> {
  const seen = new Set<string>();
  for (const name of rawCandidates(preferred)) {
    const valid = validUsername(name);
    if (valid === undefined || seen.has(valid)) continue;
    seen.add(valid);
    yield valid;
  }
}

function* rawCandidates(preferred: string): Generator<string> {
  const base = validUsername(preferred) ?? FALLBACK_USERNAME;
  yield base;
  for (let n = 2; n <= MAX_NAME_SUFFIX; n += 1) yield withSuffix(base, `-${n}`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    yield withSuffix(base, `-${generateUserId().slice(0, 8)}`);
  }
  // Whatever the base was, these always fit the policy.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    yield `${FALLBACK_USERNAME}-${generateUserId().slice(0, 8)}`;
  }
}

function validUsername(name: string): string | undefined {
  try {
    return normaliseUsername(name);
  } catch (error) {
    if (error instanceof UsernamePolicyError) return undefined;
    throw error;
  }
}

/**
 * `base` cut to leave room for `suffix` within `MAX_USERNAME_LENGTH` UTF-16
 * units, then the suffix. Cut by code point, never through a surrogate pair,
 * and with any trailing space dropped (a cut can land just after one, and
 * `name -2` is not the name with a suffix).
 */
function withSuffix(base: string, suffix: string): string {
  const room = MAX_USERNAME_LENGTH - suffix.length;
  let kept = "";
  for (const codePoint of base) {
    if (kept.length + codePoint.length > room) break;
    kept += codePoint;
  }
  return `${kept.trimEnd()}${suffix}`;
}
