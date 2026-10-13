import { SQLITE_MIGRATIONS, type Migration } from "./migrations.js";
import {
  AlreadyLinkedError,
  UserIdTakenError,
  UsernameTakenError,
  WardSubjectTakenError,
  type NewUserRecord,
  type SessionOrigin,
  type SessionRecord,
  type UserRecord,
  type WardAuthStore,
  type WardLinkRecord,
} from "./types.js";

/**
 * The built-in store, over a **synchronous** SQLite handle the app already has.
 *
 * ## One handle type for two drivers
 *
 * `SqliteHandle` is the intersection of better-sqlite3's `Database` and
 * `node:sqlite`'s `DatabaseSync`, written structurally so this file imports
 * neither driver and the bundle carries no native code. Both pass as-is:
 *
 * ```ts
 * createSqliteStore(new Database("app.db"));     // better-sqlite3
 * createSqliteStore(new DatabaseSync("app.db")); // node:sqlite
 * ```
 *
 * An app on Knex or Drizzle hands over the better-sqlite3 handle underneath.
 *
 * Living in the intersection means a few rules, each of which one of the two
 * drivers enforces:
 *
 * - **Positional `?` parameters only.** The two disagree about named-parameter
 *   prefixes.
 * - **`null`, never `undefined`,** for a missing value; better-sqlite3 throws on
 *   `undefined`.
 * - **No booleans** — numbers only. Neither driver binds a JS boolean the same
 *   way.
 * - **Transactions by SQL**, not `db.transaction()`, which only better-sqlite3
 *   has. A `SAVEPOINT` rather than `BEGIN`, so the store also works when the
 *   app calls it from inside a transaction of its own.
 * - **No reliance on `lastInsertRowid`.** Every key is chosen before the insert.
 */

/** A value either driver binds. */
export type SqlValue = string | number | bigint | null;

/** The statement surface both drivers share. Results are read as `unknown` and mapped. */
export interface SqliteStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

/** The database surface both drivers share. */
export interface SqliteHandle {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
}

/**
 * A store whose methods answer synchronously — what the SQLite store is,
 * since both drivers are synchronous. Still assignable to `AuthStore`.
 */
export type SyncStore<S> = {
  [K in keyof S]: S[K] extends (...args: infer A) => infer R ? (...args: A) => Awaited<R> : S[K];
};

/**
 * The SQLite store's own type: `WardAuthStore` (and so `AuthStore`), answered
 * synchronously.
 */
export type SqliteAuthStore = SyncStore<WardAuthStore>;

export interface SqliteStoreOptions {
  /**
   * The migration list. Defaults to `SQLITE_MIGRATIONS`, and an app should
   * never pass anything else; tests pass a longer list to prove an appended
   * migration applies.
   */
  migrations?: readonly Migration[];
}

/** Raised when the database holds a newer schema than this copy knows. */
export class SchemaTooNewError extends Error {
  constructor(found: number, known: number) {
    super(
      `auth_migrations is at version ${found} but this copy of the library only knows up to ` +
        `${known}. An older vendored build was copied over a newer one; copy the newer build back.`,
    );
    this.name = "SchemaTooNewError";
  }
}

/**
 * Run `fn` inside a savepoint: released on success, rolled back on a throw.
 * Nests correctly under an app's own `BEGIN`, which a bare `BEGIN` would not.
 */
export function inSavepoint<T>(db: SqliteHandle, fn: () => T): T {
  db.exec("SAVEPOINT ward_auth");
  try {
    const result = fn();
    db.exec("RELEASE ward_auth");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO ward_auth");
    db.exec("RELEASE ward_auth");
    throw error;
  }
}

/**
 * Apply every migration newer than what `auth_migrations` records, each in its
 * own savepoint, in order. Idempotent: a second call applies nothing.
 *
 * Returns the versions it applied, for a boot log line.
 */
export function migrateSqlite(
  db: SqliteHandle,
  migrations: readonly Migration[] = SQLITE_MIGRATIONS,
): number[] {
  assertOrdered(migrations);

  db.exec(`CREATE TABLE IF NOT EXISTS auth_migrations (
    version    INTEGER PRIMARY KEY NOT NULL,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const row = db.prepare("SELECT MAX(version) AS version FROM auth_migrations").get() as
    { version: number | bigint | null } | undefined;
  const current = Number(row?.version ?? 0);
  const known = migrations.length === 0 ? 0 : migrations[migrations.length - 1]!.version;

  // An older copy over a newer database would run against tables it does not
  // understand. Refuse at boot rather than fail somewhere stranger later.
  if (current > known) throw new SchemaTooNewError(current, known);

  const record = db.prepare(
    "INSERT INTO auth_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  const applied: number[] = [];

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    inSavepoint(db, () => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, Date.now());
    });
    applied.push(migration.version);
  }

  return applied;
}

function assertOrdered(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `migration "${migration.name}" has version ${migration.version}; versions must run 1, 2, 3… in order`,
      );
    }
  });
}

interface UserRow {
  id: string;
  username: string;
  username_folded: string;
  password_hash: string | null;
  role: string;
  created_at: number | bigint;
  updated_at: number | bigint;
}

interface WardLinkRow {
  subject: string;
  user_id: string;
  linked_at: number | bigint;
}

function toWardLink(row: WardLinkRow): WardLinkRecord {
  return { subject: row.subject, userId: row.user_id, linkedAt: Number(row.linked_at) };
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  origin: string;
  ward_sid: string | null;
  created_at: number | bigint;
  renewed_at: number | bigint;
  expires_at: number | bigint;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    usernameFolded: row.username_folded,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    idHash: row.id_hash,
    userId: row.user_id,
    // The CHECK constraint keeps anything else out of the column.
    origin: row.origin as SessionOrigin,
    wardSid: row.ward_sid,
    createdAt: Number(row.created_at),
    renewedAt: Number(row.renewed_at),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * The SQLite `AuthStore`. Runs pending migrations first, so the tables exist
 * by the time this returns; call it once at boot, after the app's own
 * migrations or before them — the two never touch each other's tables.
 */
export function createSqliteStore(
  db: SqliteHandle,
  options: SqliteStoreOptions = {},
): SqliteAuthStore {
  migrateSqlite(db, options.migrations ?? SQLITE_MIGRATIONS);

  // Prepared once. Both drivers keep a prepared statement valid for the life
  // of the connection.
  const s = {
    userById: db.prepare("SELECT * FROM auth_users WHERE id = ?"),
    userByFolded: db.prepare("SELECT * FROM auth_users WHERE username_folded = ?"),
    insertUser: db.prepare(
      `INSERT INTO auth_users (id, username, username_folded, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    setPasswordHash: db.prepare(
      "UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?",
    ),
    setRole: db.prepare("UPDATE auth_users SET role = ?, updated_at = ? WHERE id = ?"),
    insertSession: db.prepare(
      `INSERT INTO auth_sessions (id_hash, user_id, origin, ward_sid, created_at, renewed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    sessionById: db.prepare("SELECT * FROM auth_sessions WHERE id_hash = ?"),
    renewSession: db.prepare(
      "UPDATE auth_sessions SET renewed_at = ?, expires_at = ? WHERE id_hash = ?",
    ),
    deleteSession: db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?"),
    deleteUserSessions: db.prepare("DELETE FROM auth_sessions WHERE user_id = ?"),
    deleteUserSessionsExcept: db.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ? AND id_hash <> ?",
    ),
    deleteExpired: db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?"),
    linkBySubject: db.prepare("SELECT * FROM auth_ward_links WHERE subject = ?"),
    linkByUserId: db.prepare("SELECT * FROM auth_ward_links WHERE user_id = ?"),
    insertLink: db.prepare(
      "INSERT INTO auth_ward_links (subject, user_id, linked_at) VALUES (?, ?, ?)",
    ),
    deleteLink: db.prepare("DELETE FROM auth_ward_links WHERE user_id = ?"),
    deleteUserWardSessions: db.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ? AND origin = 'ward'",
    ),
    setSessionIdToken: db.prepare("UPDATE auth_sessions SET ward_id_token = ? WHERE id_hash = ?"),
    sessionIdToken: db.prepare("SELECT ward_id_token FROM auth_sessions WHERE id_hash = ?"),
    setReauthenticatedAt: db.prepare(
      "UPDATE auth_sessions SET reauthenticated_at = ? WHERE id_hash = ?",
    ),
    reauthenticatedAt: db.prepare("SELECT reauthenticated_at FROM auth_sessions WHERE id_hash = ?"),
  };

  function insertUser(user: NewUserRecord): UserRecord {
    // Checked inside the caller's savepoint rather than by catching the
    // constraint error: the two drivers report a UNIQUE violation with
    // different error shapes, and an explicit check gives one typed error on
    // both.
    if (s.userById.get(user.id) !== undefined) throw new UserIdTakenError();
    if (s.userByFolded.get(user.usernameFolded) !== undefined) throw new UsernameTakenError();
    s.insertUser.run(
      user.id,
      user.username,
      user.usernameFolded,
      user.passwordHash,
      user.role,
      user.createdAt,
      user.createdAt,
    );
    return toUser(s.userById.get(user.id) as UserRow);
  }

  function insertLink(link: WardLinkRecord): void {
    if (s.linkBySubject.get(link.subject) !== undefined) throw new WardSubjectTakenError();
    if (s.linkByUserId.get(link.userId) !== undefined) throw new AlreadyLinkedError();
    s.insertLink.run(link.subject, link.userId, link.linkedAt);
  }

  return {
    createUser(user: NewUserRecord): UserRecord {
      return inSavepoint(db, () => insertUser(user));
    },

    findUserById(id: string): UserRecord | undefined {
      const row = s.userById.get(id) as UserRow | undefined;
      return row === undefined ? undefined : toUser(row);
    },

    findUserByFoldedUsername(usernameFolded: string): UserRecord | undefined {
      const row = s.userByFolded.get(usernameFolded) as UserRow | undefined;
      return row === undefined ? undefined : toUser(row);
    },

    setPasswordHash(userId: string, passwordHash: string | null, now: number): void {
      s.setPasswordHash.run(passwordHash, now, userId);
    },

    setRole(userId: string, role: string, now: number): void {
      s.setRole.run(role, now, userId);
    },

    createSession(session: SessionRecord): void {
      s.insertSession.run(
        session.idHash,
        session.userId,
        session.origin,
        session.wardSid,
        session.createdAt,
        session.renewedAt,
        session.expiresAt,
      );
    },

    findSession(idHash: string): SessionRecord | undefined {
      const row = s.sessionById.get(idHash) as SessionRow | undefined;
      return row === undefined ? undefined : toSession(row);
    },

    renewSession(idHash: string, renewedAt: number, expiresAt: number): void {
      s.renewSession.run(renewedAt, expiresAt, idHash);
    },

    deleteSession(idHash: string): void {
      s.deleteSession.run(idHash);
    },

    deleteUserSessions(userId: string, exceptIdHash?: string): number {
      const result =
        exceptIdHash === undefined
          ? s.deleteUserSessions.run(userId)
          : s.deleteUserSessionsExcept.run(userId, exceptIdHash);
      return Number(result.changes);
    },

    deleteExpiredSessions(now: number): number {
      return Number(s.deleteExpired.run(now).changes);
    },

    findWardLinkBySubject(subject: string): WardLinkRecord | undefined {
      const row = s.linkBySubject.get(subject) as WardLinkRow | undefined;
      return row === undefined ? undefined : toWardLink(row);
    },

    findWardLinkByUserId(userId: string): WardLinkRecord | undefined {
      const row = s.linkByUserId.get(userId) as WardLinkRow | undefined;
      return row === undefined ? undefined : toWardLink(row);
    },

    createWardLink(link: WardLinkRecord): void {
      inSavepoint(db, () => insertLink(link));
    },

    createUserWithWardLink(user: NewUserRecord, subject: string): UserRecord {
      return inSavepoint(db, () => {
        const created = insertUser(user);
        insertLink({ subject, userId: created.id, linkedAt: user.createdAt });
        return created;
      });
    },

    deleteWardLink(userId: string): number {
      return Number(s.deleteLink.run(userId).changes);
    },

    deleteUserWardSessions(userId: string): number {
      return Number(s.deleteUserWardSessions.run(userId).changes);
    },

    setSessionWardIdToken(idHash: string, idToken: string): void {
      s.setSessionIdToken.run(idToken, idHash);
    },

    findSessionWardIdToken(idHash: string): string | undefined {
      const row = s.sessionIdToken.get(idHash) as { ward_id_token: string | null } | undefined;
      return row?.ward_id_token ?? undefined;
    },

    setSessionReauthenticatedAt(idHash: string, at: number): void {
      s.setReauthenticatedAt.run(at, idHash);
    },

    findSessionReauthenticatedAt(idHash: string): number | undefined {
      const row = s.reauthenticatedAt.get(idHash) as
        { reauthenticated_at: number | bigint | null } | undefined;
      const at = row?.reauthenticated_at;
      return at === undefined || at === null ? undefined : Number(at);
    },
  };
}
