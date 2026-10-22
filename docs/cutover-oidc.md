# Cutover: local accounts and "Sign in with Ward"

The owner's runbook for brief 27. It moves production from Ward's shared cookie
to the shape in [decisions-oidc.md](../corpus/wiki/decisions-oidc.md): every app
signs people in with its own accounts, and Ward is the OpenID Connect provider
behind each app's "Sign in with Ward" button.

**Status: done.** Production was cut over on 2026-10-13, and brief 30 removed
the old contract from Ward's code the same day. It reaches production with the
next Ward deploy (step 9).

**Since 2026-10-22 (brief 32) Ward has a host of its own.** Read `<origin>/ward`
below as `https://ward.<domain>` and `<origin>/ward-api` as
`https://ward.<domain>/ward-api`: the console is at `https://ward.<domain>/console`,
and every app's `WARD_OIDC_ISSUER` is `https://ward.<domain>/ward-api/oidc`.
The apps' own redirect URIs did not change.

Every step here is yours to run. The deploy configuration is already in
vps-deploy: `stacks/ward.ts`, the five app stacks, and the `useWard` lines in
`app.ts`.

**Notation.** `<origin>` is the production origin: `https://` plus the domain,
with no path. `<svc>` is the ssh target of the services account, the one
vps-deploy reads as `SVC_SSH_HOST` from `secrets/vps.env`. Commands marked
"on the box" run in a shell there as that account. Every command marked "here"
runs on your machine, from the checkout it names.

Every shell on the box must first point `docker` at the account's rootless
daemon. Run this once in each new shell before any command below:

```bash
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
```

**Why this order was safe.** The old contract (app keys, `/introspect` and the
shared cookie) stayed live in Ward until brief 30 retired it on 2026-10-13. A
Ward of that time served both the old and the new flow, so the apps still in
production kept working after step 3. Each new app version stops reading
`WARD_APP_KEY`, so apps could move one at a time.

## 0. Before you start: one key pair per app

Here, in Ward's checkout, once per client id:

```bash
npm run oidc-client-key --workspace=api -- atrium
npm run oidc-client-key --workspace=api -- newspapper
npm run oidc-client-key --workspace=api -- prm
npm run oidc-client-key --workspace=api -- sports-app
npm run oidc-client-key --workspace=api -- satchel   # only when satchel first deploys
```

Each run prints two things and writes nothing:

1. A `WARD_OIDC_CLIENT_KEY=…` line. This is the app's private key. Put it in
   that stack's secrets file in vps-deploy:

   | Client id | File |
   |---|---|
   | `atrium` | `secrets/atrium.env` |
   | `newspapper` | `secrets/newspapper.env` |
   | `prm` | `secrets/public-resource-map.env` (the stack name, not the slug) |
   | `sports-app` | `secrets/sports-app.env` |
   | `satchel` | `secrets/satchel.env` |

2. A one-line public JWK. Keep it for step 4. It is the only half Ward ever
   sees. Never paste the private line into Ward.

Use new pairs for production. Do not reuse the keys the local seed wrote into
the apps' development `.env` files.

Each file's old `WARD_APP_KEY` is read by nothing once its app redeploys.
Brief 30 is done, so you can delete those lines. `secrets/sports-app.env` must
also keep `SPORTS_APP_SYNC_SECRET`. The stack still requires it although the
service no longer reads it (vps-deploy brief 09).

A deploy of an app stack without `WARD_OIDC_CLIENT_KEY` stops at preflight and
names the file. A Ward deploy does not need any of them.

## 1. Back up Ward's database

SQLite in WAL mode keeps committed data in `ward.db-wal` until the database is
closed. A copy of `ward.db` alone can be empty
([decisions-implementation.md](../corpus/wiki/decisions-implementation.md)).
So stop the container, which closes the database, and copy the whole data
directory: `ward.db`, `ward.db-wal`, `ward.db-shm`, the signing key and the
mail spool.

On the box:

```bash
STAMP=$(date +%Y%m%d-%H%M); mkdir -p ~/backups
cd /srv/ward-api
docker compose -f infrastructure/docker-compose.yml stop ward-api
tar -czf ~/backups/ward-$STAMP.tgz -C /srv/ward-api data
docker compose -f infrastructure/docker-compose.yml start ward-api
```

Here, pull it off the box. A backup that only lives next to the original is
not a backup:

```bash
ssh <svc> 'cat ~/backups/ward-<stamp>.tgz' > ward-<stamp>.tgz
```

## 2. Back up each app's database

Same pattern: stop, copy the data directory, start. On the box, in the same
shell as step 1 (so `STAMP` is still set):

```bash
cd /srv/atrium-api
docker compose -f infrastructure/docker-compose.yml stop atrium-api
tar -czf ~/backups/atrium-$STAMP.tgz -C /srv/atrium-api/apps/api data
docker compose -f infrastructure/docker-compose.yml start atrium-api

cd /srv/prm-api
docker compose -f infrastructure/docker-compose.yml stop prm-api
tar -czf ~/backups/prm-$STAMP.tgz -C /srv/prm-api data
docker compose -f infrastructure/docker-compose.yml start prm-api

cd /srv/sports-app-api
docker compose -f infrastructure/docker-compose.yml stop sports-app-api
tar -czf ~/backups/sports-app-$STAMP.tgz -C /srv/sports-app-api data
docker compose -f infrastructure/docker-compose.yml start sports-app-api

cd /srv/newspapper
docker compose -f infrastructure/docker-compose.yml stop newspapper
tar -czf ~/backups/newspapper-$STAMP.tgz -C /srv/newspapper/state data
docker compose -f infrastructure/docker-compose.yml start newspapper
```

Atrium's archive holds the database only. Its book files (`library`, `images`,
`latex`, `versions` beside `data`) are not touched by this cutover. newspapper's
`state/data` holds its database and its uploads. Pull the four archives here
the same way as Ward's. satchel has no production data yet.

All compose projects on the box are named `infrastructure`, after the
directory that holds each compose file. Containers are therefore called
`infrastructure-<service>-1`, not `<service>`. Use
`docker compose -f infrastructure/docker-compose.yml …` from the service's
directory, as above, rather than `docker exec <service>`.

## 3. Deploy Ward

Here, in vps-deploy:

```bash
node cli.ts ward all
```

This sets `WARD_OIDC_ISSUER=<origin>/ward-api/oidc`, `WARD_UI_URL=<origin>/ward`
and `WARD_TRUSTED_PROXIES=172.16.0.0/12`. Ward's migrations add the client
columns and the provider's table at boot. The old routes stay as they are.
The run also ships `ward-docs` from whatever Ward's `docs/dist` holds. Run
`npm run docs` in Ward's `docs/` first if you want the site current.

Check the provider. The `issuer` in the answer must be exactly
`<origin>/ward-api/oidc`:

```bash
curl -s <origin>/ward-api/oidc/.well-known/openid-configuration
```

### Confirm the trusted range

`172.16.0.0/12` is Docker's default bridge pool. Under the rootless daemon,
check it rather than trust it. On the box, list every network's subnet. Each
one should be inside 172.16.0.0 to 172.31.255.255:

```bash
docker network ls -q | xargs docker network inspect \
  --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
```

Then make one bad login at `<origin>/ward/login` (a wrong password for any
name), and on the box:

```bash
cd /srv/ward-api
docker compose -f infrastructure/docker-compose.yml logs --since 10m ward-api \
  | grep 'X-Forwarded-For ignored'
```

- **Nothing printed, and the console's Audit page shows the failed login with
  `detail.ip` set to your own public address:** the value is right.
- **A line printed:** its `peer` is the address Docker connects from, and it is
  not trusted. Every caller then shares one lockout bucket. Change
  `TRUSTED_PROXIES` in vps-deploy's `stacks/ward.ts` to a range that covers the
  peer, run `node cli.ts ward server`, and repeat the check. The apps read the
  same constant, so they pick it up on their deploys in step 5.

## 4. Register each app's client in Ward's console

Sign in to the console (`<origin>/ward/console`), open **Apps**, then each app,
then its **Sign in with Ward** panel. Enter the three values, exactly as shown,
and save:

| App | Redirect URI | Sign-out return URI |
|---|---|---|
| `atrium` | `<origin>/atrium-api/auth/ward/callback` | `<origin>/atrium/` |
| `newspapper` | `<origin>/newspapper/api/auth/ward/callback` | `<origin>/newspapper/` |
| `prm` | `<origin>/prm-api/auth/ward/callback` | `<origin>/prm/` |
| `sports-app` | `<origin>/sports-app-api/api/auth/ward/callback` | `<origin>/sports-app/` |
| `satchel` | `<origin>/satchel-api/auth/ward/callback` | `<origin>/satchel/` |

The public key is that app's JWK line from step 0. sports-app's double `api`
is correct: its server routes everything under `/api`. If satchel has no app
row yet, create it under Apps first.

The redirect URIs must match the deployed ones character for character. The
deploy builds them from the same prefixes (`useWard` in vps-deploy). An app
whose panel is empty answers `invalid_client` on its Ward button. Local sign-in
still works.

The button only lets in Ward accounts that hold a grant for that app. Your
existing grants carry over.

## 5. Deploy each app

Here, in vps-deploy, one at a time. **atrium goes before just-a-bot** (step 7):

```bash
node cli.ts atrium all
node cli.ts newspapper all
node cli.ts public-resource-map all
node cli.ts sports-app all
```

Each deploy writes the app's public origin, `WARD_OIDC_ISSUER`,
`WARD_OIDC_CLIENT_ID`, `WARD_OIDC_CLIENT_KEY`, `WARD_OIDC_REDIRECT_URI`,
`WARD_OIDC_POST_LOGOUT_REDIRECT_URI` and `AUTH_TRUSTED_PROXIES`. It no longer
writes `WARD_PUBLIC_ORIGIN`, `WARD_API_BASE_PATH` or `WARD_APP_KEY`. newspapper
also gets `NEWSPAPPER_BASE=/newspapper/` at runtime. sports-app gets
`SPORTS_APP_API_PREFIX=/sports-app-api` in its service and in its client build.

At boot, each app's migration creates its local users:

- **atrium:** every Ward subject becomes a linked user named `user-<8 chars>`,
  role `member`, with no password. That includes the Discord bot's subject
  until step 7.
- **prm:** the same naming, role `user`.
- **sports-app:** each stream keyed by a Ward subject becomes a linked user
  named by that subject.
- **newspapper:** nothing to migrate.

Everyone is signed out of each app once, because the session cookie is new.

**When satchel first deploys:** step 0's key in `secrets/satchel.env`, step 4's
panel, then `node cli.ts satchel all`.

## 6. Give yourself a local way into each app

A Ward-linked user has no local password, so it cannot get in while Ward is
down. Fix that once per app.

**atrium, prm and sports-app: sign in with Ward, then set a password.** Your
migrated user holds your existing data, so do not seed a new owner account
there: it would be a second, empty one, and nothing links accounts by name.
Click "Sign in with Ward" on the app's login page, then set a local password
in the app's settings. Setting a first password needs a Ward sign-in from the
last ten minutes, and the settings page offers one. In atrium and prm the
username stays `user-<8 chars>`, since there is no rename yet. That name is
what you type at the local login. In sports-app it is your Ward subject, 32 hex
characters, because that was your stream's key.

prm's migrated users are all `user`. Promote yourself, on the box:

```bash
cd /srv/prm-api
docker compose -f infrastructure/docker-compose.yml exec prm-api \
  node backend/dist/db/set-role.js <your user-xxxxxxxx name> admin
```

**newspapper and satchel: seed an owner, then link Ward.** Each seed script
leaves an existing user untouched, so it is safe to re-run. Read the password
into the shell first, so it never sits on a command line or in your history.
`-e NAME` with no value passes the variable through from that shell. On the
box:

```bash
read -rsp 'Password: ' SEED_PASSWORD; echo; export SEED_PASSWORD
export SEED_USERNAME=<name>

cd /srv/newspapper
docker compose -f infrastructure/docker-compose.yml exec \
  -e SEED_USERNAME -e SEED_PASSWORD -e SEED_ROLE=admin \
  newspapper npm run seed -w @newspapper/api
# when satchel is deployed:
cd /srv/satchel-api
docker compose -f infrastructure/docker-compose.yml exec \
  -e SEED_USERNAME -e SEED_PASSWORD -e SEED_ROLE=admin \
  satchel-api node server/dist/seed.js

unset SEED_PASSWORD
```

Sign in with that account, then link Ward from the app's settings. If you
press "Sign in with Ward" first instead, Ward's grant creates a separate user.

For reference, the seed commands of the other three apps are below. Use them
for accounts other than your own (step 7 uses atrium's).

| App | Seed, run from its service directory |
|---|---|
| atrium | `docker compose -f infrastructure/docker-compose.yml exec -e SEED_USERNAME -e SEED_PASSWORD -e SEED_ROLE=member atrium-api node apps/api/dist/scripts/seed-user.js` |
| prm | `docker compose -f infrastructure/docker-compose.yml exec -e SEED_USERNAME -e SEED_PASSWORD -e SEED_ROLE=admin prm-api node backend/dist/db/seed-users.js` |
| sports-app | `docker compose -f infrastructure/docker-compose.yml exec -e SPORTS_APP_SEED_USERNAME -e SPORTS_APP_SEED_PASSWORD sports-app-api node server/seed-users.mjs` |

sports-app reads its own names (`SPORTS_APP_SEED_USERNAME`,
`SPORTS_APP_SEED_PASSWORD`) and needs no role. Seeding a name that matches a
stream from before Ward makes that stream readable again.

## 7. The Jukebox (just-a-bot)

The bot used to sign in to atrium through Ward. Now it uses a local atrium
account with the `jukebox` role. After atrium is deployed (step 5):

1. **Seed the Jukebox user in atrium**, on the box, with a new name and a
   generated password:

   ```bash
   read -rsp 'Jukebox password: ' SEED_PASSWORD; echo; export SEED_PASSWORD
   export SEED_USERNAME=<jukebox name>
   cd /srv/atrium-api
   docker compose -f infrastructure/docker-compose.yml exec \
     -e SEED_USERNAME -e SEED_PASSWORD -e SEED_ROLE=jukebox \
     atrium-api node apps/api/dist/scripts/seed-user.js
   unset SEED_PASSWORD
   ```

2. **Rename the bot's variables**, here, in just-a-bot's `bots/discord/.env`.
   The deploy pushes that file to the box.
   - Delete `JUKEBOX_WARD_URL`.
   - Replace `JUKEBOX_WARD_USERNAME` with `JUKEBOX_ATRIUM_USERNAME`, and
     `JUKEBOX_WARD_PASSWORD` with `JUKEBOX_ATRIUM_PASSWORD`. Their values are
     the Jukebox user's from step 1.
   - Keep `JUKEBOX_ATRIUM_URL`.

   A bot deploy before this rename refuses to boot.
3. **Deploy the bot**, here, in vps-deploy: `node cli.ts just-a-bot all`.
   just-a-bot depends on atrium in vps-deploy, so a batch run orders them, and
   a lone bot deploy warns if atrium is not part of it.
4. **Remove the bot's old `atrium` grant** in Ward's console. Its migrated
   atrium user (`user-<8 chars>`, `member`) has no password, so once the grant
   is gone nothing can sign in as it.

## 8. Check, then tell the controller

For each app:

- local sign-in works;
- "Sign in with Ward" comes back signed in;
- "sign out of Ward too" lands on the app's own page.

Revoking a session in Ward's console should end that app's Ward-originated
session within 30 seconds.

## 9. Only then: brief 30 (done 2026-10-13)

Brief 30 retired the old contract once every app in production ran the new
version: app keys and the `app_keys` table, `/introspect`, the shared cookie
(the access cookie is now at `Path=/ward-api`), the app-wide `?next=` list and
`client/`. Only Ward redeploys for it: here, in vps-deploy,
`node cli.ts ward all`, which runs the migration that drops `app_keys`. No app
stack needs a redeploy. Each app's `WARD_APP_KEY` line in vps-deploy's secrets
can now be deleted.
