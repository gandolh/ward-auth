import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { SQLITE_MIGRATIONS, type Migration } from "./migrations.js";
import {
  SchemaTooNewError,
  createSqliteStore,
  migrateSqlite,
  type SqliteHandle,
} from "./sqlite.js";
import {
  AlreadyLinkedError,
  UserIdTakenError,
  UsernameTakenError,
  WardSubjectTakenError,
  type SessionRecord,
} from "./types.js";

/**
 * The built-in store, run once per driver. Every app hands over one of these
 * two handles, and the store is written to their intersection — so each case
 * below runs on both, and a driver difference shows up as a failure in one
 * column only.
 */

/**
 * Compile-time check that both real handle types satisfy `SqliteHandle` with
 * no cast. If a driver's typings drift away from the interface, `npm run
 * typecheck` fails here rather than in an app.
 */
const _typesFit: [SqliteHandle, SqliteHandle] = [
  new Database(":memory:"),
  new DatabaseSync(":memory:"),
];
void _typesFit;

const drivers: Array<[string, () => SqliteHandle]> = [
  ["better-sqlite3", () => new Database(":memory:")],
  ["node:sqlite", () => new DatabaseSync(":memory:")],
];

function user(overrides: Partial<{ id: string; username: string; folded: string }> = {}) {
  const username = overrides.username ?? "Alice";
  return {
    id: overrides.id ?? "u-alice",
    username,
    usernameFolded: overrides.folded ?? username.toLowerCase(),
    passwordHash: "salt:hash",
    role: "member",
    createdAt: 1_000,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    idHash: "h1",
    userId: "u-alice",
    origin: "local",
    wardSid: null,
    createdAt: 1_000,
    renewedAt: 1_000,
    expiresAt: 10_000,
    ...overrides,
  };
}

/** The version an appended migration takes. */
const NEXT = SQLITE_MIGRATIONS.length + 1;

describe.each(drivers)("createSqliteStore on %s", (_name, open) => {
  it("creates its own auth_* tables and records the migration", () => {
    const db = open();
    createSqliteStore(db);

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(tables).toEqual(["auth_migrations", "auth_sessions", "auth_users", "auth_ward_links"]);

    const versions = db.prepare("SELECT version, name FROM auth_migrations").all();
    expect(versions.map((row) => ({ ...(row as object) }))).toEqual([
      { version: 1, name: "local_accounts" },
      { version: 2, name: "ward_links" },
      { version: 3, name: "session_reauthenticated_at" },
    ]);
  });

  it("upgrades a 0.2/0.3.0 database in place, keeping its sessions", () => {
    const db = open();
    expect(migrateSqlite(db, SQLITE_MIGRATIONS.slice(0, 2))).toEqual([1, 2]);
    db.exec(
      `INSERT INTO auth_users (id, username, username_folded, password_hash, role, created_at, updated_at)
       VALUES ('u-alice', 'Alice', 'alice', NULL, 'member', 1, 1);
       INSERT INTO auth_sessions (id_hash, user_id, origin, ward_sid, created_at, renewed_at, expires_at)
       VALUES ('kept', 'u-alice', 'ward', 'family', 1, 1, 9999999999999);`,
    );

    const store = createSqliteStore(db);
    expect(store.findSession("kept")).toBeDefined();
    expect(store.findSessionReauthenticatedAt("kept")).toBeUndefined();
  });

  it("is idempotent: a second store over the same handle applies nothing", () => {
    const db = open();
    createSqliteStore(db);
    expect(migrateSqlite(db)).toEqual([]);
    createSqliteStore(db);
  });

  it("applies a migration appended to the list, and only that one", () => {
    const db = open();
    createSqliteStore(db);

    const appended: Migration[] = [
      ...SQLITE_MIGRATIONS,
      { version: NEXT, name: "extra", sql: "CREATE TABLE auth_extra (id TEXT PRIMARY KEY)" },
    ];
    expect(migrateSqlite(db, appended)).toEqual([NEXT]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_extra").get()).toMatchObject({ n: 0 });
  });

  it("refuses to run an older copy over a newer schema", () => {
    const db = open();
    migrateSqlite(db, [
      ...SQLITE_MIGRATIONS,
      { version: NEXT, name: "future", sql: "CREATE TABLE auth_future (id TEXT)" },
    ]);
    expect(() => createSqliteStore(db)).toThrow(SchemaTooNewError);
  });

  it("refuses a migration list that is out of order", () => {
    expect(() =>
      migrateSqlite(open(), [{ version: 2, name: "skipped-one", sql: "SELECT 1" }]),
    ).toThrow(/versions must run 1, 2, 3/);
  });

  it("rolls a failing migration back whole", () => {
    const db = open();
    const broken: Migration[] = [
      ...SQLITE_MIGRATIONS,
      { version: NEXT, name: "broken", sql: "CREATE TABLE auth_half (id TEXT); NOT SQL AT ALL" },
    ];
    expect(() => migrateSqlite(db, broken)).toThrow();
    // The shipped migrations committed; the broken one left no table and no record.
    expect(db.prepare("SELECT MAX(version) AS v FROM auth_migrations").get()).toMatchObject({
      v: NEXT - 1,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'auth_half'").get(),
    ).toMatchObject({ n: 0 });
  });

  it("creates and finds users by id and by folded username", () => {
    const store = createSqliteStore(open());
    const created = store.createUser(user());

    expect(created).toEqual({
      id: "u-alice",
      username: "Alice",
      usernameFolded: "alice",
      passwordHash: "salt:hash",
      role: "member",
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(store.findUserById("u-alice")).toEqual(created);
    expect(store.findUserByFoldedUsername("alice")).toEqual(created);
    expect(store.findUserById("nobody")).toBeUndefined();
    expect(store.findUserByFoldedUsername("nobody")).toBeUndefined();
  });

  it("stores a user with no password as null", () => {
    const store = createSqliteStore(open());
    store.createUser({ ...user(), passwordHash: null });
    expect(store.findUserById("u-alice")?.passwordHash).toBeNull();
  });

  it("refuses a taken username and a taken id with typed errors", () => {
    const store = createSqliteStore(open());
    store.createUser(user());

    expect(() => store.createUser(user({ id: "u-other" }))).toThrow(UsernameTakenError);
    expect(() => store.createUser(user({ username: "Bob" }))).toThrow(UserIdTakenError);
  });

  it("works inside a transaction the app already opened", () => {
    const db = open();
    const store = createSqliteStore(db);

    db.exec("BEGIN");
    store.createUser(user());
    expect(() => store.createUser(user({ id: "u-2" }))).toThrow(UsernameTakenError);
    db.exec("ROLLBACK");

    // The app's rollback wins: the savepoint nested under it.
    expect(store.findUserById("u-alice")).toBeUndefined();
  });

  it("updates the password hash and the role", () => {
    const store = createSqliteStore(open());
    store.createUser(user());

    store.setPasswordHash("u-alice", "salt2:hash2", 2_000);
    store.setRole("u-alice", "admin", 3_000);

    expect(store.findUserById("u-alice")).toMatchObject({
      passwordHash: "salt2:hash2",
      role: "admin",
      updatedAt: 3_000,
    });
  });

  it("creates, renews, finds and deletes sessions", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createSession(session());

    expect(store.findSession("h1")).toEqual(session());

    store.renewSession("h1", 5_000, 20_000);
    expect(store.findSession("h1")).toMatchObject({ renewedAt: 5_000, expiresAt: 20_000 });

    store.deleteSession("h1");
    expect(store.findSession("h1")).toBeUndefined();
  });

  it("keeps a Ward-originated session's sid, and refuses a mismatched pair", () => {
    const store = createSqliteStore(open());
    store.createUser(user());

    store.createSession(session({ idHash: "w1", origin: "ward", wardSid: "family-1" }));
    expect(store.findSession("w1")).toMatchObject({ origin: "ward", wardSid: "family-1" });

    // The CHECK ties the two columns together, so no row can be half of each.
    expect(() =>
      store.createSession(session({ idHash: "w2", origin: "ward", wardSid: null })),
    ).toThrow();
    expect(() => store.createSession(session({ idHash: "w3", wardSid: "family-1" }))).toThrow();
  });

  it("deletes a user's sessions, optionally sparing one", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createUser(user({ id: "u-bob", username: "Bob" }));
    store.createSession(session({ idHash: "a1" }));
    store.createSession(session({ idHash: "a2" }));
    store.createSession(session({ idHash: "a3" }));
    store.createSession(session({ idHash: "b1", userId: "u-bob" }));

    expect(store.deleteUserSessions("u-alice", "a2")).toBe(2);
    expect(store.findSession("a2")).toBeDefined();
    expect(store.findSession("b1")).toBeDefined();

    expect(store.deleteUserSessions("u-alice")).toBe(1);
    expect(store.findSession("a2")).toBeUndefined();
  });

  it("deletes expired sessions and nothing else", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createSession(session({ idHash: "old", expiresAt: 5_000 }));
    store.createSession(session({ idHash: "new", expiresAt: 50_000 }));

    expect(store.deleteExpiredSessions(5_000)).toBe(1);
    expect(store.findSession("old")).toBeUndefined();
    expect(store.findSession("new")).toBeDefined();
  });

  it("links a Ward subject one-to-one, and refuses either side twice", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createUser(user({ id: "u-bob", username: "Bob" }));

    store.createWardLink({ subject: "s-alice", userId: "u-alice", linkedAt: 1 });
    expect(store.findWardLinkBySubject("s-alice")).toEqual({
      subject: "s-alice",
      userId: "u-alice",
      linkedAt: 1,
    });
    expect(store.findWardLinkByUserId("u-alice")?.subject).toBe("s-alice");

    expect(() =>
      store.createWardLink({ subject: "s-alice", userId: "u-bob", linkedAt: 2 }),
    ).toThrow(WardSubjectTakenError);
    expect(() =>
      store.createWardLink({ subject: "s-other", userId: "u-alice", linkedAt: 2 }),
    ).toThrow(AlreadyLinkedError);

    expect(store.deleteWardLink("u-alice")).toBe(1);
    expect(store.findWardLinkBySubject("s-alice")).toBeUndefined();
  });

  it("creates a user with its link in one transaction, or neither", () => {
    const store = createSqliteStore(open());
    store.createUser(user({ id: "u-bob", username: "Bob" }));
    store.createWardLink({ subject: "taken", userId: "u-bob", linkedAt: 1 });

    // The subject as the local id: the migration path for rows keyed by it.
    const created = store.createUserWithWardLink(
      user({ id: "s-carol", username: "Carol" }),
      "s-carol",
    );
    expect(created.id).toBe("s-carol");
    expect(store.findWardLinkBySubject("s-carol")?.userId).toBe("s-carol");

    expect(() =>
      store.createUserWithWardLink(user({ id: "u-dan", username: "Dan" }), "taken"),
    ).toThrow(WardSubjectTakenError);
    expect(store.findUserById("u-dan")).toBeUndefined();
  });

  it("keeps a Ward session's ID token, and ends only the user's Ward sessions", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createSession(session({ idHash: "local" }));
    store.createSession(session({ idHash: "ward", origin: "ward", wardSid: "family" }));
    store.setSessionWardIdToken("ward", "header.claims.signature");
    expect(store.findSessionWardIdToken("ward")).toBe("header.claims.signature");
    expect(store.findSessionWardIdToken("local")).toBeUndefined();

    expect(store.deleteUserWardSessions("u-alice")).toBe(1);
    expect(store.findSession("ward")).toBeUndefined();
    expect(store.findSession("local")).toBeDefined();
  });

  it("records when a session reauthenticated, null until then", () => {
    const store = createSqliteStore(open());
    store.createUser(user());
    store.createSession(session({ idHash: "ward", origin: "ward", wardSid: "family" }));
    expect(store.findSessionReauthenticatedAt("ward")).toBeUndefined();
    store.setSessionReauthenticatedAt("ward", 1_700_000_000_123);
    expect(store.findSessionReauthenticatedAt("ward")).toBe(1_700_000_000_123);
    expect(store.findSessionReauthenticatedAt("missing")).toBeUndefined();
  });
});
