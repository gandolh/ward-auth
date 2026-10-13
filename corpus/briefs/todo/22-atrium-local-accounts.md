# Brief 22 — Atrium gets local accounts and a Ward button

## Context

Atrium signs in only through Ward today: `apps/api/src/modules/ward/`
(client, guard, types) and `apps/web/src/auth/AuthGate.tsx`, with profiles
keyed by the Ward subject (`profiles.subject`, from the
`20260906000000-ward-cutover` migration). Before Ward it had its own accounts
(D30), and its profiles (D35) sit inside an account.

**Atrium decisions this revises.** Write revision notes in
`atrium/corpus/wiki/decisions.md`:
- **D30**: accounts are atrium's own again, with Ward as a linked way in.
- **D35** is unchanged: profiles stay inside an account, and the account is now
  a local user.

Depends on briefs 20 and 21. Follow the adoption guide in this repo's `shared-library/README.md` (written by brief 21) and the rules in [decisions-oidc.md](../../wiki/decisions-oidc.md).

## Files you OWN

- `atrium/vendor/ward/**`, `atrium/apps/api/package.json`
- `atrium/apps/api/src/modules/ward/**` (replaced by the library), `apps/api/src/app.ts`,
  `apps/api/src/common/config.ts`, a new migration, and a seed script
- `atrium/apps/web/src/auth/**` and a new login page and settings section in atrium's own design
- `atrium/apps/web/vite.config.ts` (drop the dev `/ward` proxy)
- `atrium/corpus/**` (decisions D30 note, log)

## Files you must NOT touch

- Ward itself (`api/`, `ui/`, `shared-library/`). A defect in the library is
  fixed in Ward's `shared-library/`, released as a new version, and vendored
  again, never patched in the app's copy.
- Domain code beyond re-keying.

## What to do

1. Vendor the library and register the plugin in place of the Ward guard.
   Keep atrium's app-wide `onRequest` shape.
2. Migration: every existing subject in `profiles.subject` becomes a local
   user whose id **is** that subject, linked to the same Ward subject. Profile
   rows keep their keys. Then rename the column only if it is cheap; say which
   you chose.
3. A login page in the Reading Room design with the "Sign in with Ward" button.
   No register page.
4. Cover images and media must still load: they are served under the API path,
   so the scoped cookie reaches them. Verify it in the browser.
5. A seed script (`npm run seed:user`) reads the username, password and role
   from the environment, never from the repo.
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
