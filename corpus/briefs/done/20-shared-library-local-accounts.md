# Brief 20 — The shared library: local accounts

## Context

Every app gets its own users, passwords and sessions again, and the shared
logic lives once, in this repo at `shared-library/`, copied into each app as a
built bundle ([decisions-oidc.md](../../wiki/decisions-oidc.md), "The shared
code is a built library each app copies in"). This brief builds the local half.
Brief 21 adds "Sign in with Ward" on top.

The hard parts are already written and tested in Ward itself:
`api/src/auth/password.ts` (scrypt from `node:crypto`, see
[decisions-implementation.md](../../wiki/decisions-implementation.md)),
`lockout.ts` (keyed on the forwarded address, never `request.ip`) and
`cookie.ts`. Port them rather than reinventing them. The dummy hash on an
unknown username stays, so timing does not reveal which accounts exist.

The five apps and their database handles:

| App | Server | Database access |
|---|---|---|
| atrium | Fastify, TS | Knex over better-sqlite3 |
| public-resource-map | Fastify, TS | Drizzle over better-sqlite3 |
| newspapper | Fastify, TS | better-sqlite3 |
| satchel | Fastify, TS | better-sqlite3 |
| sports-app | Fastify, plain `.mjs` | `node:sqlite` `DatabaseSync` |

Every one of them can hand over a synchronous SQLite handle.

## Files you OWN

- `shared-library/**` (new workspace in this repo's root `package.json`)
- `corpus/wiki/decisions-oidc.md`, `corpus/wiki/glossary.md`, `corpus/log.md`

## Files you must NOT touch

- `api/`, `ui/`, `client/`. The library depends on none of them.
- Any app repo. Apps adopt it in briefs 22–26.

## What to do

1. **Core, framework-free:** password hashing and verification, lockout,
   opaque server-side sessions (random 32 bytes, stored hashed, with expiry and
   a sliding renewal; pick the lifetimes and say why), user creation, password
   change (ends the user's other sessions), and the seed helper.
   - Users have an opaque, stable, never-reused id, a unique username, and a
     role string the app defines.
   - Ids are created by the library, but an app may pass in an existing id when
     it migrates. Briefs 22 and 24 reuse each migrated user's Ward subject as
     their local id, so existing rows keep their keys.
   - No email, no self-service reset. Registration is a function the app may
     expose or not; only prm does (brief 24).
2. **Storage behind an interface.** Ship one implementation that takes a
   synchronous SQLite handle, works on both better-sqlite3 and `node:sqlite`,
   and runs its own migrations into its own tables (`auth_*` prefix, its own
   migrations table). Test it against both drivers.
3. **Fastify plugin:**
   - Routes: login, logout, session ("who am I"), change password, and
     optionally register.
   - An app-wide `onRequest` guard with an allowlist, so no route does its own
     authentication (atrium's rule).
   - The app's cookie: a unique name per app (`<app>_session`), HttpOnly,
     `SameSite=Lax`, `Secure` except on loopback, and `Path=` the app's API
     prefix. Every request that needs the session, including WebSocket upgrades
     and `<img>` fetches, must live under that path.
   - Fastify is a peer dependency.
4. **React hooks, unstyled:** `useSession`, `useLogin`, `useLogout`,
   `useChangePassword` and `useRegister`. They return state and handlers, and
   render nothing, so every app keeps its own login page. React is a peer
   dependency.
5. **Build and vendoring:**
   - The copy holds exactly the files listed in
     [decisions-oidc.md](../../wiki/decisions-oidc.md) under "What a copy
     holds": `ward-auth.js`, `ward-auth-react.js`, their two `.d.ts` files, a
     `README.md` and a `LICENSE` (MIT).
   - Bundle the third-party dependencies in. Do not minify. No source maps and
     no `package.json`; apps import the bundle by relative path.
   - `npm run vendor -- <target dir>` writes the build plus the README. The
     README gives the version, the source (`https://github.com/gandolh/ward-auth`,
     folder `shared-library/`), and the CHANGELOG link for upgrade notes. No
     local paths, no domain.
   - Keep a `CHANGELOG.md` in `shared-library/`. Every breaking change gets an
     upgrade note, because upgrading is a manual copy.
6. Add glossary entries for **local account**, **linked Ward identity** and
   **Ward-originated session**.

## Acceptance

- Unit tests for hashing, lockout (including the forwarded-address key) and
  sessions, plus the store tested on better-sqlite3 and on `node:sqlite`.
- An integration test drives the Fastify plugin end to end: seed, login,
  guarded route, password change ends other sessions, logout.
- `npm run vendor` into a scratch directory produces something a plain `.mjs`
  Fastify server imports and runs with no install step beyond its own
  dependencies.
- The vendored directory holds exactly the six files. The README contains no
  local path and no production domain (a test greps it).
- Ward's test suite, typecheck and lint pass.

## Outcome (2026-10-13)

Shipped in `shared-library/` (commit "Shared library: local accounts,
sessions, lockout and the vendor build (brief 20)").
- Core accounts, scrypt, lockout keyed on the forwarded address, and opaque
  sessions: 14-day sliding idle, 30-day absolute, renewal written at most
  hourly.
- A SQLite store tested on better-sqlite3 and `node:sqlite`.
- A Fastify plugin with a fail-closed guard and a `validateSession` hook for
  brief 21.
- Unstyled React hooks.
- `npm run vendor -- <dir>` writes exactly the six files.

Build calls are in decisions-oidc-build.md. The bundler is Rollup with
TypeScript's `transpileModule`, because esbuild strips the comments that carry
the security reasoning.

Notes for adopters:
- Register `wardAuth` before any app route; the guard covers only routes
  registered after it.
- Use `routePrefix`, not Fastify's `prefix`.

Verified by the controller after merging with brief 18 on main: 1155 tests,
typecheck, lint, build and corpus lint clean. `npm run fmt:check` already
failed on three files from before this brief (`api/src/scripts/register-app-keys.ts`,
`client/src/verify.ts`, `client/src/verify.test.ts`).
