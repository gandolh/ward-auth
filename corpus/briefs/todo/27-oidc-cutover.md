# Brief 27 — Cut the estate over to local accounts and OIDC

## Context

Briefs 18–26 build Ward's provider, the shared library and each app's adoption.
This brief takes it to production. See [decisions-oidc.md](../../wiki/decisions-oidc.md).

**Deploys are an owner step.** This brief writes the deploy changes and the
exact commands. The owner runs them.

Depends on briefs 18–26, 28 and 29.

## Files you OWN

- `vps-deploy/stacks/ward.ts`, `atrium.ts`, `newspapper.ts`,
  `public-resource-map.ts`, `sports-app.ts`, `satchel.ts` and the `app.ts`
  lines that wire Ward into each stack
- In this repo: `corpus/wiki/status.md`, `overview.md`, `log.md`, and a new
  owner runbook `docs/cutover-oidc.md` (no domain, no secrets)
- In each app repo: only its production Dockerfile, if its image lacks
  `vendor/`

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
3. **Every production image must contain the vendored library.** Build each
   app's production image and import the bundle inside it. Atrium, prm and
   satchel were fixed in Wave C; check newspapper and sports-app.
4. **Trusted proxies** (brief 28): `WARD_TRUSTED_PROXIES` for Ward and
   `AUTH_TRUSTED_PROXIES` for every app, with the value brief 28 recommends.
5. **The Jukebox** (brief 29): atrium deploys before just-a-bot, and the bot's
   `.env` is renamed first.
6. **Retiring the old contract is brief 30**, and it starts only after the
   owner confirms production runs on the new flow.
7. Update [status.md](../../wiki/status.md) and
   [overview.md](../../wiki/overview.md) to the new shape.

## Acceptance

- The deploy changes typecheck in vps-deploy, and its own tests pass.
- The owner has the exact command list, in order, in `docs/cutover-oidc.md`
  (brief-board is down).
