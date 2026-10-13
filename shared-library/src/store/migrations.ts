/**
 * The library's own schema, as an ordered list of migrations.
 *
 * The tables are the library's, not the app's: every name carries the `auth_`
 * prefix and the applied versions live in `auth_migrations`, so they sit
 * beside an app's own Knex, Drizzle or hand-rolled migrations without either
 * system seeing the other's rows.
 *
 * ## Appending a migration
 *
 * Add an entry at the **end** with the next `version`. Never edit or reorder
 * one that has shipped: a vendored copy in some app has already applied it,
 * and the runner records versions, not contents. Version 2 (0.2.0) added the
 * Ward link table this way, and version 3 (0.3.1) a session column.
 *
 * ## The SQL is the intersection of two drivers
 *
 * Apps hand over either a better-sqlite3 handle or a `node:sqlite`
 * `DatabaseSync`. Both are SQLite underneath, so plain DDL is portable; what
 * differs is the driver surface, and that is handled in `sqlite.ts`.
 */

export interface Migration {
  /** Strictly increasing, starting at 1. Recorded in `auth_migrations`. */
  version: number;
  /** For the migrations table and for error messages. */
  name: string;
  /** One or more statements, run with `exec` inside one transaction. */
  sql: string;
}

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "local_accounts",
    sql: `
      CREATE TABLE auth_users (
        -- Opaque and never reused. Minted by the library, or a migrated Ward
        -- subject (briefs 22 and 24) so existing rows keep their keys.
        id              TEXT    PRIMARY KEY NOT NULL,
        username        TEXT    NOT NULL,
        username_folded TEXT    NOT NULL UNIQUE,
        -- NULL for a user created by a first Ward sign-in (brief 21): they
        -- have no local password until they set one.
        password_hash   TEXT,
        role            TEXT    NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE auth_sessions (
        -- SHA-256 of the cookie value. The token itself is never stored.
        id_hash     TEXT    PRIMARY KEY NOT NULL,
        user_id     TEXT    NOT NULL REFERENCES auth_users (id),
        -- 'ward' sessions are checked against Ward every 30 seconds (brief 21).
        origin      TEXT    NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'ward')),
        -- Ward's refresh family id for a Ward-originated session, else NULL.
        ward_sid    TEXT,
        created_at  INTEGER NOT NULL,
        renewed_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        CHECK ((origin = 'ward') = (ward_sid IS NOT NULL))
      );

      CREATE INDEX auth_sessions_user_id ON auth_sessions (user_id);
      CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at);
      CREATE INDEX auth_sessions_ward_sid ON auth_sessions (ward_sid) WHERE ward_sid IS NOT NULL;
    `,
  },
  {
    version: 2,
    name: "ward_links",
    sql: `
      -- One Ward account per local user and one local user per Ward account.
      -- A row exists only because a person signed in with Ward (creating the
      -- user) or linked Ward from their own settings: never by matching a
      -- username (decisions-oidc.md, "linking never guesses").
      CREATE TABLE auth_ward_links (
        -- Ward's subject, the ID token's "sub". Opaque, stable, never reused.
        subject    TEXT    PRIMARY KEY NOT NULL,
        user_id    TEXT    NOT NULL UNIQUE REFERENCES auth_users (id),
        linked_at  INTEGER NOT NULL
      );

      -- The ID token a Ward-originated session began with, kept only to be
      -- the id_token_hint of "sign out of Ward too". Ward accepts an
      -- expired hint, so it outlives the token's own hour. NULL for a local
      -- session.
      ALTER TABLE auth_sessions ADD COLUMN ward_id_token TEXT;
    `,
  },
  {
    version: 3,
    name: "session_reauthenticated_at",
    sql: `
      -- When this session last came back from a Ward round trip that made
      -- the person type their Ward password (prompt=login, auth_time checked).
      -- Epoch milliseconds on the app's clock. Setting a first local password
      -- requires it to be recent; a plain or silent Ward sign-in never sets
      -- it. NULL until then.
      ALTER TABLE auth_sessions ADD COLUMN reauthenticated_at INTEGER;
    `,
  },
];
