/**
 * The SQLite surface the store and its migrations use: the intersection of
 * better-sqlite3's `Database` and `node:sqlite`'s `DatabaseSync`, written
 * structurally so the library imports neither driver. `sqlite.ts` says which
 * rules living in the intersection brings.
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
