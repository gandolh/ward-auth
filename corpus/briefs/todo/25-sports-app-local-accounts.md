# Brief 25 — sports-app gets local accounts and a Ward button

## Context

sports-app's server is plain `.mjs` on `node:sqlite` (`server/db.mjs`,
`server/state-server.mjs`) with a hand-written Ward client (`server/ward.mjs`).
Snapshots are keyed by **username**. Ward's sign-in had a known loop: nothing
called `setCurrentUsername` and there was no `/api/me`. The client keeps a
per-user session in `client/src/persistence/session.ts` and syncs in
`client/src/persistence/sync.ts`.

Depends on briefs 20 and 21. Follow the adoption guide in this repo's `shared-library/README.md` (written by brief 21) and the rules in [decisions-oidc.md](../../wiki/decisions-oidc.md).

## Files you OWN

- `sports-app/vendor/ward/**`, `server/package.json`
- `sports-app/server/ward.mjs` (replaced), `server/state-server.mjs`, `server/db.mjs` (only to hand over the handle), a seed script
- `sports-app/client/src/persistence/session.ts`, `sync.ts`, `client/src/ui/components/SyncSettings.tsx`,
  a new login page in the app's design
- the client dev server config (drop the `/ward` proxy)
- `sports-app/corpus/**` (decision, log)

## Files you must NOT touch

- Ward itself (`api/`, `ui/`, `shared-library/`). A defect in the library is
  fixed in Ward's `shared-library/`, released as a new version, and vendored
  again, never patched in the app's copy.
- Domain code beyond re-keying.

## What to do

1. Vendor the library (it is plain ES modules, so the `.mjs` server imports
   it directly) and hand it the `DatabaseSync` handle.
2. Snapshots stay keyed by username. A migrated Ward user becomes a local user
   with the same username, linked to Ward. A first Ward sign-in that finds the
   username taken gets a suffixed one, so check the snapshot key follows the
   local username, not the Ward one.
3. Add the `/api/me`-style session call the client was missing, and fix the
   sign-in loop as part of this.
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
- `vendor/ward/` holds only the bundles, their types, the README and the LICENSE.
- The app's test suite, typecheck and lint pass. Its corpus has a log entry and
  a decision recording the change.
