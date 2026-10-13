# Changelog

Every version an app can vendor, newest first. Upgrading is a manual copy
(`npm run vendor -- <app>/vendor/ward`), so **every breaking change carries an
upgrade note** saying exactly what the app must change.

Schema changes are migrations the library applies itself on
`createSqliteStore`; a note says when one is added, and never to edit one.

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
