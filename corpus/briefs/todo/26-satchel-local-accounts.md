# Brief 26 — Satchel gets local accounts and a Ward button

## Context

Satchel signs in only through Ward today: `server/src/ward/` (session,
claims, guard, errors) with `accounts.subject` as the primary key every other
table references (`server/src/db/migrations.ts`). It has a WebSocket
(`@fastify/websocket`) and a CLI that authenticates with `agent_tokens`, which
are not Ward and stay as they are. Satchel is registered with local Ward and
not deployed.

Depends on briefs 20 and 21. Follow the adoption guide in this repo's `shared-library/README.md` (written by brief 21) and the rules in [decisions-oidc.md](../../wiki/decisions-oidc.md).

## Files you OWN

- `satchel/vendor/ward/**`, `server/package.json`
- `satchel/server/src/ward/**` (replaced), `server/src/app.ts`, `server/src/index.ts`, `server/src/config.ts`,
  a new migration, a seed script
- `satchel/web/src/ward.ts`, `web/src/auth/**`, `web/src/settings/Settings.tsx`, a new login page in satchel's design
- the web dev server config (drop the `/ward` proxy)
- `satchel/corpus/**` (decision, log)

## Files you must NOT touch

- Ward itself (`api/`, `ui/`, `shared-library/`). A defect in the library is
  fixed in Ward's `shared-library/`, released as a new version, and vendored
  again, never patched in the app's copy.
- Domain code beyond re-keying.

## What to do

1. Vendor the library and register the plugin in place of `ward/`. Leave
   `agent_tokens` and the CLI path untouched.
2. Migration: every `accounts.subject` becomes a local user whose id is that
   subject, linked to Ward. Foreign keys keep working.
3. The WebSocket upgrade must be under the cookie's path and must go through
   the same guard, including the 30-second Ward check for Ward-originated
   sessions on a long-lived socket. Decide whether the socket re-checks
   periodically or only on connect, and record why.
4. A login page with the "Sign in with Ward" button. No register page.
5. A seed script reads the username and password from the environment.
6. Run against the local Ward container with this app registered as a client
   (the seed does it). Remove the old Ward env trio from `.env.example`.

## Acceptance

- The app's own login page signs a seeded local user in, with Ward stopped.
- "Sign in with Ward" against the local Ward container
  ([infrastructure/local/README.md](../../../infrastructure/local/README.md))
  signs a granted user in. A user with no grant sees the app's own
  `access_denied` message.
- Revoking that Ward session in Ward's console ends the app session within
  30 seconds. With Ward stopped, that session is rejected with the
  `ward_unavailable` message, and a local session keeps working.
- Settings can link Ward to a local user, unlink it, and set a local password.
- `vendor/ward/README.md` names only the source and the version.
- The app's test suite, typecheck and lint pass. Its corpus has a log entry and
  a decision recording the change.
