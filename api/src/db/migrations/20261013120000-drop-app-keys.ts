import type Database from "better-sqlite3";

/**
 * Brief 30 — retire the shared-cookie contract: drop `app_keys`.
 *
 * App keys authenticated an app to `/introspect` and, for a while, to
 * `/notify`. Both uses are gone: apps sign people in through OpenID Connect and
 * authenticate to `/session-status` and `/notify` with a client assertion
 * signed by a key only they hold (`decisions-oidc.md`). Nothing reads or writes
 * the table any more, and a table of credential hashes that nothing checks is a
 * liability rather than history — the history is in `audit_log`, whose
 * `app_key.*` rows stay, and in `corpus/wiki/decisions-app-keys.md`.
 *
 * `IF EXISTS` because the table's own migration (`20260906000000-app-keys`)
 * always runs first in `MIGRATIONS`, so it is present on every database this
 * meets; the guard only spares a hand-repaired database a hard failure. The
 * index goes with the table.
 *
 * Forward-only, like every migration here: the keys were sha256 digests of
 * secrets nobody kept, so there is nothing a `down` could restore.
 */
export function up(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS app_keys`);
}
