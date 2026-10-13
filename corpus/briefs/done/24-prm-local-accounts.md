# Brief 24 — public-resource-map gets local accounts, local registration and a Ward button

## Context

prm signs in only through Ward today: `backend/src/ward/` (client, plugin,
config) with users keyed by the Ward subject in `backend/src/db/schema.ts`
(Drizzle). Its navbar links to Ward's register page
(`ui/app/components/Navbar.tsx`, `wardRegisterUrl`). It mails users through
Ward's `POST /notify` (`backend/src/jobs/reminder-sweep.ts`).

prm is the **one app with a register page**, and the owner chose a **local**
register page for it (2026-10-13).

Depends on briefs 20 and 21. Follow the adoption guide in this repo's `shared-library/README.md` (written by brief 21) and the rules in [decisions-oidc.md](../../wiki/decisions-oidc.md).

## Files you OWN

- `public-resource-map/vendor/ward/**`, `backend/package.json`
- `public-resource-map/backend/src/ward/**` (replaced), `backend/src/app.ts`, `backend/src/index.ts`,
  `backend/src/db/schema.ts` and a new migration, `backend/src/db/seed.ts`,
  `backend/src/jobs/reminder-sweep.ts` (notify through the library)
- `public-resource-map/ui/app/lib/authApi.ts`, `ui/app/routes.ts`, `ui/app/components/Navbar.tsx`,
  new login and register pages and a settings section, in prm's design and i18n
- the ui dev server config (drop the `/ward` proxy)
- `public-resource-map/corpus/**` (decision, log)

## Files you must NOT touch

- Ward itself (`api/`, `ui/`, `shared-library/`). A defect in the library is
  fixed in Ward's `shared-library/`, released as a new version, and vendored
  again, never patched in the app's copy.
- Domain code beyond re-keying.

## What to do

1. Vendor the library and register the plugin in place of `ward/`. prm's
   `user`/`admin` roles become the local role.
2. Migration: every existing subject becomes a local user whose id is that
   subject, linked to Ward. Rows keep their keys.
3. A local register page (username and password; no email, since Ward holds
   addresses) and a login page with the "Sign in with Ward" button. The navbar
   links to them instead of Ward.
4. Mail goes through the library's `sendNotification`, which reaches only
   Ward-linked users. Local-only users get none; say so on the settings page.
5. Seed and test users come from the environment, never the repo.
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

Shipped in prm (`ec3bf41`, 0.3.0 in `5e64355`).
- Local registration and a login page with the Ward button, plus settings,
  all through prm's i18n.
- Subjects became linked users at boot: `user-<8 chars>`, role `user`.
  prm never stored roles; promote with `db:set-role`.
- Mail goes through `notifyUser`, for Ward-linked users only.
- Playwright now signs in through prm's own accounts.
- `PUBLIC_ORIGIN` is required in production.
- The production image copies `backend/vendor`.
- prm surfaced the shared-lockout bug that became brief 28.

234 vitest and 30 Playwright tests, typecheck and build pass.
