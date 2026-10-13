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
 * The next brief adds Ward identities. It extends this interface rather than
 * editing it — `interface WardAuthStore extends AuthStore { ... }` — and
 * appends a migration to `SQLITE_MIGRATIONS` for its table. Existing methods
 * keep their signatures, so an app that only uses local accounts is not
 * affected by the upgrade.
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
