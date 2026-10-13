# Changelog

Every version an app can vendor, newest first. Upgrading is a manual copy
(`npm run vendor -- <app>/vendor/ward`), so **every breaking change carries an
upgrade note** saying exactly what the app must change.

Schema changes are migrations the library applies itself on
`createSqliteStore`; a note says when one is added, and never to edit one.

## 0.2.0 — 2026-10-13

"Sign in with Ward". The adoption guide is [README.md](./README.md).

- Ward client (`createWardClient`, `wardClientOptionsFromEnv`): an OpenID
  Connect code flow with PKCE against Ward through a bundled `openid-client`
  6.8.8, `private_key_jwt` client authentication with the app's Ed25519 key,
  and ID tokens pinned to `EdDSA` with their signatures verified. Discovery
  runs once, lazily, so an app boots while Ward is down.
- The 30-second check: `POST /session-status` for Ward-originated sessions,
  cached 30 s per Ward session with concurrent checks collapsed into one, and
  failing closed (`ward_unavailable`, or `ward_misconfigured` on a `401`).
  Local sessions never call Ward.
- Linking (`createWardIdentities`): a first Ward sign-in creates a linked
  user, link and unlink from settings, `createLinkedUser` for migrating rows
  keyed by a Ward subject, and `notifyUser` for mail through Ward. Nothing is
  ever matched by username.
- Fastify: the `ward` option of `wardAuth` adds `/ward/start`,
  `/ward/callback`, `/ward/link`, `/ward/reauthenticate`, `/ward/unlink`,
  `/ward/set-password` and `/ward/logout` under `routePrefix`.
- React: `useWardSignIn`, `useWardLink`, `useWardUnlink`,
  `useSetLocalPassword`, `useWardSignOut` and `useWardResult`.
- Store: migration 2 adds `auth_ward_links` and `auth_sessions.ward_id_token`.
  `createSqliteStore` applies it. `WardAuthStore` extends `AuthStore`.

Upgrade notes from 0.1.0:

- Vendor the new build. Migration 2 applies itself on the next
  `createSqliteStore`.
- `GET /session`, `POST /login` and `POST /register` answer a new field,
  `ward: { enabled, linked }`. The React `SessionState` has `ward` on
  `signed_in` and `signed_out`. Code that builds or deep-compares those
  objects must add it.
- `SqliteAuthStore` is now `SyncStore<WardAuthStore>`, a superset of before.
- A custom `AuthStore` keeps working for local accounts. The `ward` option
  needs a store that implements `WardAuthStore`.
- A session that began with Ward is refused (`ward_unavailable`) by a plugin
  without the `ward` option. 0.1.0 never created one.

## 0.1.0 — 2026-10-13

First version: local accounts.

- Core: scrypt passwords (ported from Ward, hashes portable both ways), the
  address-keyed lockout with per-account forgiveness, opaque server-side
  sessions (32 random bytes, stored as SHA-256; 14-day sliding idle expiry,
  30-day absolute, renewed at most hourly), user creation with an optional
  app-supplied id, password change that ends the user's other sessions, and
  `seedUsers`.
- Store: `createSqliteStore(handle)` over better-sqlite3 or `node:sqlite`.
  Migration 1 creates `auth_users`, `auth_sessions` and `auth_migrations`.
- Fastify: the `wardAuth` plugin (login, logout, session, password, optional
  register) and the app-wide `onRequest` guard with an allowlist and a
  `validateSession` hook; `requireRole`.
- React: `configureAuth`, `useSession`, `useLogin`, `useLogout`,
  `useChangePassword`, `useRegister`.

Upgrade notes: none — nothing to upgrade from.
