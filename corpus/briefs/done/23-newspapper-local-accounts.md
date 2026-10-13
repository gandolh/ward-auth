# Brief 23 — Newspapper gets local accounts and a Ward button

## Context

Newspapper signs in only through Ward today: `api/src/ward/` (client, guard,
types, a fake Ward for tests) and `api/src/routes/me.ts`. Before Ward it had
one first-boot account and an HMAC cookie
(`newspapper/corpus/wiki/decisions-security.md`). The IP-keyed lockout
reasoning there still applies to a local login and should carry over to the
library's lockout.

Depends on briefs 20 and 21. Follow the adoption guide in this repo's `shared-library/README.md` (written by brief 21) and the rules in [decisions-oidc.md](../../wiki/decisions-oidc.md).

## Files you OWN

- `newspapper/vendor/ward/**`, `newspapper/api/package.json`
- `newspapper/api/src/ward/**` (replaced), `api/src/server.ts`, `api/src/routes/me.ts`, a seed script
- `newspapper/ui/src/router.tsx`, a new login page and settings section in the Mechanical design
- the ui dev server config (drop the `/ward` proxy)
- `newspapper/corpus/**` (a decisions-security revision note, log)

## Files you must NOT touch

- Ward itself (`api/`, `ui/`, `shared-library/`). A defect in the library is
  fixed in Ward's `shared-library/`, released as a new version, and vendored
  again, never patched in the app's copy.
- Domain code beyond re-keying.

## What to do

1. Vendor the library and register the plugin in place of `ward/`. Keep the
   test seam the fake Ward gave you; the library's test helpers replace it.
2. Migration: any row keyed by the Ward subject keeps it, as the local id of
   the migrated user.
3. A login page in the Mechanical design with the "Sign in with Ward" button.
   No register page.
4. `/uploads/*` stays public for headless rendering, as decided in newspapper's
   corpus. Do not put it behind the guard.
5. A seed script reads the username, password and role from the environment.
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

## Outcome (2026-10-13)

Shipped in newspapper (`0b81aa6`, 0.3.0 in `d216f2b`).
- Nothing to migrate: no table holds a user key since its v5.
- `routePrefix` is `/api/auth`.
- The cookie is scoped to `/newspapper`, not `/newspapper/api`, because
  guarded output and upload images sit beside the API prefix.
- `/uploads/*` stays guarded, as newspapper's own decisions-security.md
  already decided. This brief's "stays public" was stale.
- `NEWSPAPPER_BASE` must be set at runtime for the cookie path (brief 27).

905 tests, lint and build pass, and a browser check of local sign-in was
done.
