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
5. Remove the shared `Path=/` session cookie apps used to read. Ward's own
   cookies stay scoped to Ward.
6. Write a migration that drops the app-key table, appended last.

## Acceptance

- Ward's suite, typecheck, lint and build pass, with no reference to app keys
  or `/introspect` outside migrations and the corpus history.
- The local seed no longer writes the old variables.
