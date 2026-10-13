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

## Outcome (2026-10-13)

The code side is done, and the deploy is the owner's.

**vps-deploy.**
- `useWard` writes the OIDC client environment and `AUTH_TRUSTED_PROXIES`.
- Ward gets `WARD_OIDC_ISSUER`, `WARD_UI_URL` and `WARD_TRUSTED_PROXIES`.
  The trusted range is one constant, `172.16.0.0/12`, unverified under the
  rootless daemon.
- Each app's key is the required secret `WARD_OIDC_CLIENT_KEY` in
  `secrets/<stack>.env`.
- newspapper gets `NEWSPAPPER_BASE` at runtime. sports-app gets
  `SPORTS_APP_API_PREFIX` at runtime and at build time.
- just-a-bot now depends on atrium.
- Typecheck and `--check` are clean; vps-deploy has no test suite.

**Images.** newspapper's and sports-app's production images already ship
`vendor/`, and their seed commands run inside the images.

**Runbook.** The owner's steps are in `docs/cutover-oidc.md`. Two departures
from this brief:
- **Owners of atrium, prm and sports-app are not seeded.** Their migrated
  Ward user already holds the data, so they sign in with Ward once and set a
  local password.
- **The Jukebox order is deploy atrium, then seed, then rename, then deploy the
  bot.** The seed script exists only in the new image.

**Commands.** Containers are reached through
`docker compose -f infrastructure/docker-compose.yml exec`, because no stack
sets `container_name`.

**Possibly stale.** The secrets templates in vps-deploy were not read (its
corpus forbids opening `secrets/`). They may still name `WARD_APP_KEY`.
