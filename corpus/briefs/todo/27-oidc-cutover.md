# Brief 27 — Cut the estate over to local accounts and OIDC, then retire the old contract

## Context

Briefs 18–26 build Ward's provider, the shared library and each app's adoption.
This brief takes it to production and removes what the old contract leaves
behind. See [decisions-oidc.md](../../wiki/decisions-oidc.md).

**Deploys are an owner step.** This brief writes the deploy changes and the
exact commands. The owner runs them.

Depends on briefs 18–26.

## Files you OWN

- `vps-deploy/stacks/ward.ts`, `atrium.ts`, `newspapper.ts`,
  `public-resource-map.ts`, `sports-app.ts`, `satchel.ts` and the `app.ts`
  lines that wire Ward into each stack
- In this repo: `/introspect`, the app-key routes, the console's app-key panel,
  `api/src/scripts/register-app-keys.ts`, `ui/src/lib/estate.ts` (`ESTATE_APPS`
  and `?next=`), `client/`, `corpus/wiki/integrating.md`, `status.md`,
  `overview.md`, `log.md`

## What to do

1. **Deploy config:**
   - Each app stack drops `WARD_APP_KEY` and the old Ward trio, and gains the
     issuer, its client id and its client credential, held the way the stack
     holds other secrets.
   - The Ward stack gains `WARD_OIDC_ISSUER`.
   - Nothing names the domain in docs.
2. **The order, written out for the owner:**
   1. Back up Ward's database. All three files, `ward.db`, `-wal` and `-shm`
      ([decisions-implementation.md](../../wiki/decisions-implementation.md)).
   2. Back up each app's database.
   3. Deploy Ward.
   4. Register each app's client and redirect URI in the console.
   5. Deploy each app; its migration creates the local users.
   6. Seed each app's owner account with a local password, from the
      environment.
3. **Retire the old contract only after every app is on the new one:**
   - Remove `/introspect`, app keys and their console panel.
   - Remove the `?next=` estate list. Ward's own account page keeps its links
     where they still make sense.
   - Remove `x-ward-app-key` on `/notify`.
   - Move `client/` to the superseded reference, or delete it and say which.
   - Remove the shared `Path=/` session cookie apps used to read; Ward's own
     cookies stay scoped to Ward.
4. Rewrite [integrating.md](../../wiki/integrating.md) as a short pointer to
   the library's adoption guide and the OIDC docs page, with the five rules
   restated for `/session-status`.
5. Update [status.md](../../wiki/status.md) and
   [overview.md](../../wiki/overview.md) to the new shape.

## Acceptance

- The deploy changes typecheck in vps-deploy, and its own tests pass.
- After the retirement step, Ward's suite passes with no reference to app keys
  or `/introspect` outside migrations and the corpus history.
- The owner has the exact command list, in order, on the brief-board ticket.
