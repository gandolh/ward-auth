import type Database from "better-sqlite3";

/**
 * A per-connection cache of prepared statements.
 *
 * Every function in the table modules takes its `Database` as a parameter
 * rather than reaching for the process-wide singleton, because that is what
 * makes the whole layer testable against `openDatabase(":memory:")` without an
 * environment. The cost of that choice is that a statement cannot simply be
 * prepared once at module load — a `better-sqlite3` statement belongs to the
 * connection it was compiled against and cannot be moved to another.
 *
 * Re-preparing on every call would work and would be wasteful on the hot
 * paths — the session check behind every Ward page load and every app's
 * `/session-status` call — because `db.prepare()` re-parses and re-plans the
 * SQL each time. So each module
 * declares its statements once through this helper and gets them compiled
 * lazily, per connection, on first use.
 *
 * The cache is a `WeakMap` keyed on the connection so a database that goes out
 * of scope — every `:memory:` database a test opens — takes its statements with
 * it rather than pinning them for the life of the process.
 *
 * @example
 * const stmts = prepareOnce((db) => ({
 *   byId: db.prepare("SELECT * FROM users WHERE subject = ?"),
 * }));
 * // then, inside an exported function:
 * stmts(db).byId.get(subject);
 */
export function prepareOnce<T>(build: (db: Database.Database) => T): (db: Database.Database) => T {
  const cache = new WeakMap<Database.Database, T>();

  return (db) => {
    let statements = cache.get(db);
    if (statements === undefined) {
      statements = build(db);
      cache.set(db, statements);
    }
    return statements;
  };
}

/**
 * The row of a statement that always returns one: an `INSERT … RETURNING *`,
 * which hands back the row it wrote or throws, or a `SELECT count(*)`.
 * `better-sqlite3` types `.get()` as possibly `undefined` either way, so this
 * checks instead of asserting. It throws only if SQLite ever breaks that
 * promise, where a `!` would have handed `undefined` on.
 */
export function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("a statement that always returns a row returned none");
  return row;
}
