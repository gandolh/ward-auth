# Brief 30 — Retire the shared-cookie contract

## Context

Split out of brief 27 on 2026-10-13. The four apps in production read Ward's
shared cookie and call `/introspect` with an app key until their new versions
deploy. Removing either before then breaks production sign-in. **Start this
brief only after the owner confirms that every app in production runs the
local-accounts version and signs in through the new flow.**

## Files you OWN

- In this repo:
  - `/introspect`, the app-key routes, the console's app-key panel
  - `api/src/scripts/register-app-keys.ts`
  - `ui/src/lib/estate.ts` (`ESTATE_APPS` and `?next=`)
  - the app-key path in `/notify`
  - `client/`
  - the local seed's app-key half
  - `corpus/wiki/integrating.md`, `decisions-app-keys.md`, `status.md`,
    `overview.md`, `log.md`
- In vps-deploy: anything that still passes `WARD_APP_KEY`.

## What to do

1. Remove `/introspect`, app keys and their console panel.
2. Remove the `?next=` estate list. Ward's own account page keeps its links
   where they still make sense.
3. Remove `x-ward-app-key` on `/notify`.
4. Delete `client/` or move it to a superseded folder, and say which.
5. Rewrite `corpus/wiki/integrating.md` as a short pointer to the library's
   adoption guide and the OIDC docs page.
6. Remove the shared `Path=/` session cookie apps used to read. Ward's own
   cookies stay scoped to Ward.
7. Write a migration that drops the app-key table, appended last.

## Acceptance

- Ward's suite, typecheck, lint and build pass, with no reference to app keys
  or `/introspect` outside migrations and the corpus history.
- The local seed no longer writes the old variables.

## Outcome (2026-10-13)

The precondition was met first: the owner cut production over on 2026-10-13.
atrium, newspapper, prm and sports-app each serve their own `/auth/session`
with Ward enabled, and Ward's OIDC discovery is live.

**Removed.**
- `POST /introspect` (a request now gets `404`), app keys (`app-key.ts`,
  `db/app-keys.ts`), the console's key routes and its app-key panel, the
  `register-app-keys` script and the `seedAppKey` test fixture.
- `x-ward-app-key` on `/notify`. Only a client assertion in the body
  authenticates. No credential, or only the old header, is
  `401 {"error":"invalid_client"}` (was `invalid_app_key`). Audit rows say
  `auth: "client_assertion"` and carry no `keyId`.
- `ui/src/lib/estate.ts` (step 2). `?next=` now accepts Ward's own pages only
  (first segment exactly `ward`), and `DEFAULT_NEXT` is `/ward/account`. The
  account page names apps from the public open-apps list, else by slug.
- `createRemoteJwksKeyStore` and `jwksUrl`, which only `@ward/client` used.

**Step 4: `client/` was deleted, not moved.** It went from the root
workspaces, the lint and fmt globs, `vitest.config.ts` and the lockfile. Git
history keeps it, and `client/` is now an abandoned root in `corpus/lint.sh`.

**Step 6: the shared cookie.** `ward_session` moved from `Path=/` to
`Path=/ward-api`. Every response that sets or clears it also sends
`ward_session=; Path=/; Max-Age=0`, so a browser's old copy expires the next
time it touches Ward. Until it does, the browser sends both. Readers take
every `ward_session` value and use the first that is a live session
(`liveAccessSession` in `api/src/auth/access-session.ts`). The refresh cookie
stays first-wins on purpose: trying a second refresh token would present a
rotated one and trip reuse detection. Tests cover the legacy expiry headers,
both cookie orders, and a well-signed token from a signed-out family beside a
live one.

**Step 7.** Migration `20261013120000-drop-app-keys`, appended last, drops
`app_keys`. The `app_key.*` audit rows stay.

**Acceptance.**
- `npm test` passes, 1171 tests in 68 files. Typecheck and lint are clean.
  `npm run build`, `fmt:check` and the docs site build pass. The local
  container was rebuilt (the drop migration ran) and re-seeded without
  touching any app env file. A check against it passed 21 of 21: Ward's own
  sign-in, `/session`, `/account` and sign-out, both duplicate-cookie orders,
  `/introspect` and the key routes answering 404, `/notify` refusing an
  unauthenticated call, and an OIDC authorization reaching Ward's login step.
- No route, module or script for app keys or `/introspect` is left in `api/`
  or `ui/`. The remaining mentions are a test asserting the removed routes
  answer `404`, the drop migration, and comments citing the decisions pages.
  The docs site and the README describe the retired contract only as
  history.
- The local seed no longer mints app keys or writes `WARD_APP_KEY`,
  `WARD_PUBLIC_ORIGIN` or `WARD_API_BASE_PATH`. It does not delete them from
  existing app env files, and nothing reads them.

**vps-deploy** passes none of the old variables to any app; the five Ward
clients get only `WARD_OIDC_*`. Only comments changed there.

**Owner step.** Redeploy Ward only: `node cli.ts ward server` (runs the drop
migration), then `node cli.ts ward deploy`, or `node cli.ts ward all`. No app
stack needs a redeploy.
