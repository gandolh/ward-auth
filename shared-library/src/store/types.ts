/**
 * The storage interface the core talks to.
 *
 * Small on purpose: the core owns every rule (hashing, expiry, which sessions
 * a password change ends), and a store only reads and writes rows. One
 * implementation ships, `createSqliteStore`, over the app's own synchronous
 * SQLite handle. Every method may return a promise, so a store over an async
 * driver (a later NestJS or Postgres adapter) satisfies the same interface;
 * the core always awaits.
 *
 * ## Extending it
 *
 * Ward identities (0.2.0) extend this interface rather than editing it —
 * `WardAuthStore` below — and appended migration 2 for their table. Existing
 * methods kept their signatures, so an app that only uses local accounts is
 * not affected by the upgrade.
 */

export type Awaitable<T> = T | Promise<T>;

/**
 * Where a session began. `"local"` is a password sign-in in the app;
 * `"ward"` is a "Sign in with Ward" flow (brief 21), the only kind that is
 * checked against Ward every 30 seconds.
 */
export type SessionOrigin = "local" | "ward";

/** A user row as the core sees it. All times are epoch milliseconds. */
export interface UserRecord {
  /** Opaque, stable, never reused. Minted by the library unless an app migrated it in. */
  id: string;
  /** As entered, trimmed. Shown to people. */
  username: string;
  /** `foldUsername(username)`. Carries the uniqueness constraint. */
  usernameFolded: string;
  /**
   * scrypt `saltHex:hashHex`, or `null` for a user with no local password —
   * one created by a first Ward sign-in (brief 21). Login against a `null`
   * hash spends the dummy hash and fails, exactly like an unknown username.
   */
  passwordHash: string | null;
  /** Defined by the app. The library never interprets it. */
  role: string;
  createdAt: number;
  updatedAt: number;
}

/** A session row. The token itself is never stored, only its hash. */
export interface SessionRecord {
  /** `hashSessionToken(token)`. The primary key. */
  idHash: string;
  userId: string;
  origin: SessionOrigin;
  /**
   * Ward's session id (the refresh family `sid`) for a Ward-originated
   * session; `null` for a local one. Written by brief 21.
   */
  wardSid: string | null;
  createdAt: number;
  /** When the sliding expiry was last pushed out. Throttles the write. */
  renewedAt: number;
  /** When the session ends unless renewed first. Never past the absolute cap. */
  expiresAt: number;
}

export interface NewUserRecord {
  id: string;
  username: string;
  usernameFolded: string;
  passwordHash: string | null;
  role: string;
  createdAt: number;
}

/** Thrown by `createUser` when the folded username is already held. */
export class UsernameTakenError extends Error {
  readonly code = "username_taken" as const;
  constructor() {
    super("username is already taken");
    this.name = "UsernameTakenError";
  }
}

/** Thrown by `createUser` when a supplied id is already held. Ids are never reused. */
export class UserIdTakenError extends Error {
  readonly code = "user_id_taken" as const;
  constructor() {
    super("user id is already taken");
    this.name = "UserIdTakenError";
  }
}

export interface AuthStore {
  /** Insert a user. Throws `UsernameTakenError` or `UserIdTakenError`. */
  createUser(user: NewUserRecord): Awaitable<UserRecord>;
  findUserById(id: string): Awaitable<UserRecord | undefined>;
  /** Looks up by the **folded** name; the core folds before calling. */
  findUserByFoldedUsername(usernameFolded: string): Awaitable<UserRecord | undefined>;
  /** `null` removes the local password (brief 21 never does; it is here for symmetry). */
  setPasswordHash(userId: string, passwordHash: string | null, now: number): Awaitable<void>;
  setRole(userId: string, role: string, now: number): Awaitable<void>;

  createSession(session: SessionRecord): Awaitable<void>;
  findSession(idHash: string): Awaitable<SessionRecord | undefined>;
  /** Push the sliding expiry out. */
  renewSession(idHash: string, renewedAt: number, expiresAt: number): Awaitable<void>;
  deleteSession(idHash: string): Awaitable<void>;
  /**
   * End every session the user holds except `exceptIdHash`. Returns how many
   * ended. A password change is the caller.
   */
  deleteUserSessions(userId: string, exceptIdHash?: string): Awaitable<number>;
  /** Housekeeping: drop rows whose `expiresAt` has passed. Returns how many. */
  deleteExpiredSessions(now: number): Awaitable<number>;
}

/**
 * A link between a local user and a Ward account. Created by a first "Sign in
 * with Ward" (which also creates the user) or by "Link Ward" in the user's own
 * settings; never by matching a username.
 */
export interface WardLinkRecord {
  /** Ward's subject: the ID token's `sub`. */
  subject: string;
  userId: string;
  linkedAt: number;
}

/** Thrown when a Ward account is already linked to another local user. */
export class WardSubjectTakenError extends Error {
  readonly code = "ward_account_in_use" as const;
  constructor() {
    super("that Ward account is already linked to another user");
    this.name = "WardSubjectTakenError";
  }
}

/** Thrown when the local user already has a Ward account linked. */
export class AlreadyLinkedError extends Error {
  readonly code = "already_linked" as const;
  constructor() {
    super("this user already has a Ward account linked");
    this.name = "AlreadyLinkedError";
  }
}

/**
 * The store the Ward half needs: `AuthStore` plus the link table and the ID
 * token a Ward-originated session keeps for "sign out of Ward too". The
 * built-in SQLite store implements all of it.
 */
export interface WardAuthStore extends AuthStore {
  findWardLinkBySubject(subject: string): Awaitable<WardLinkRecord | undefined>;
  findWardLinkByUserId(userId: string): Awaitable<WardLinkRecord | undefined>;
  /** Throws `WardSubjectTakenError` or `AlreadyLinkedError`. */
  createWardLink(link: WardLinkRecord): Awaitable<void>;
  /**
   * Insert a user and its link in one transaction, so a failed link never
   * leaves a user nobody can sign in as. Throws what `createUser` and
   * `createWardLink` throw.
   */
  createUserWithWardLink(user: NewUserRecord, subject: string): Awaitable<UserRecord>;
  /** Returns how many links were removed (0 or 1). */
  deleteWardLink(userId: string): Awaitable<number>;
  /** End every Ward-originated session the user holds. Returns how many. */
  deleteUserWardSessions(userId: string): Awaitable<number>;
  setSessionWardIdToken(idHash: string, idToken: string): Awaitable<void>;
  findSessionWardIdToken(idHash: string): Awaitable<string | undefined>;
  /**
   * Record that this session just came back from a verified Ward
   * reauthentication (epoch ms). What setting a first local password checks.
   */
  setSessionReauthenticatedAt(idHash: string, at: number): Awaitable<void>;
  /** `undefined` for a session that never reauthenticated, or no such session. */
  findSessionReauthenticatedAt(idHash: string): Awaitable<number | undefined>;
}

/** Whether a store has the Ward methods (a custom `AuthStore` may not). */
export function isWardAuthStore(store: AuthStore): store is WardAuthStore {
  const candidate = store as Partial<WardAuthStore>;
  return (
    typeof candidate.findWardLinkBySubject === "function" &&
    typeof candidate.findWardLinkByUserId === "function" &&
    typeof candidate.createWardLink === "function" &&
    typeof candidate.createUserWithWardLink === "function" &&
    typeof candidate.deleteWardLink === "function" &&
    typeof candidate.deleteUserWardSessions === "function" &&
    typeof candidate.setSessionWardIdToken === "function" &&
    typeof candidate.findSessionWardIdToken === "function" &&
    typeof candidate.setSessionReauthenticatedAt === "function" &&
    typeof candidate.findSessionReauthenticatedAt === "function"
  );
}
