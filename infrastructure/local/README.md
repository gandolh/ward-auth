# Ward, locally

Ward in Docker, for working on the apps without running Ward by hand: the API
plus a small Caddy gateway that serves the UI at `/ward` and the API at
`/ward-api` on one origin, the way the VPS does. It answers on
http://localhost:8792, from this machine only.

The images are built from your working tree, so rebuild after changing or
pulling Ward.

## First start

Run everything below from this directory, `infrastructure/local/`.

1. Put the console's break-glass login in a file outside the repo:

   ```bash
   mkdir -p ~/.config/ward
   install -m 600 /dev/null ~/.config/ward/local.env
   ```

   Give it two lines, `WARD_ADMIN_USERNAME=…` and `WARD_ADMIN_PASSWORD=…`, and
   keep it out of every repo. Set `WARD_LOCAL_ENV_FILE` to keep it elsewhere.

2. Start Ward. The first start also creates the signing key:

   ```bash
   docker compose up -d --build
   ```

3. Seed it:

   ```bash
   node seed.mjs
   ```

   This registers the five apps that use Ward, creates an owner account with
   `admin` on each, and registers each app as an OpenID Connect client (see
   "Sign in with Ward" below). It writes each app's `WARD_OIDC_*` values into
   that app's local env file (table below). Until brief 30 retires them, it
   still writes the old app key, `WARD_PUBLIC_ORIGIN` and `WARD_API_BASE_PATH`
   too; no app reads them any more. It asks
   for the owner account's username and password, or reads
   `WARD_OWNER_USERNAME` and `WARD_OWNER_PASSWORD`, and stores neither. It is
   safe to re-run: keys that still work are kept and the password is not reset.

## Signing in to an app

Start the app with its usual `npm run dev`. Each app has its own login page.
Sign in with a local account (each app's seed script creates one), or press
"Sign in with Ward": the browser goes to this container's own origin, you sign
in there, and Ward sends you back to the app's callback under its API prefix.
The apps' dev servers no longer forward `/ward` here.

| App | Open | Env files `seed.mjs` writes |
| --- | --- | --- |
| atrium | http://localhost:5173/atrium/ | `atrium/.env` |
| newspapper | http://localhost:4321/newspapper/ | `newspapper/.env` |
| prm | http://localhost:5173/prm/ | `public-resource-map/.env` |
| sports-app | http://localhost:5173/sports-app/ | `sports-app/.env` |
| satchel | http://localhost:5175/satchel/ | `satchel/.env` |

Each app's own `.env.example` has the other dev values that layout needs (the
base path and API URL).

Sessions last 15 minutes and no app renews one yet. When an app starts treating
you as signed out, open `/ward/account` on its dev server, or
http://localhost:8792/: the account page renews the session from the 30-day
refresh cookie.

## Sign in with Ward (OpenID Connect)

The container also runs Ward's OpenID Connect provider, the way "Sign in with
Ward" works once the apps move to their own accounts (briefs 18–27). Its
issuer is `http://localhost:8792/ward-api/oidc` (`WARD_OIDC_ISSUER` in
`compose.yaml`), and discovery is at
http://localhost:8792/ward-api/oidc/.well-known/openid-configuration.

`seed.mjs` registers each app as a client: `client_id` is the app's slug, the
redirect URI is the shared library's callback under the app's API prefix on its
dev server (for example `http://localhost:5173/atrium-api/auth/ward/callback`)
and the sign-out return URI is its dev URL. It also makes each app a client key
pair, registers the public half, and writes the private half into the app's env
file with the rest of the client settings:

| Variable | Value |
| --- | --- |
| `WARD_OIDC_ISSUER` | `http://localhost:8792/ward-api/oidc` |
| `WARD_OIDC_CLIENT_ID` | the app's slug |
| `WARD_OIDC_CLIENT_KEY` | the app's private key, a base64url JWK |
| `WARD_OIDC_REDIRECT_URI` | the dev callback above |
| `WARD_OIDC_POST_LOGOUT_REDIRECT_URI` | the app's dev URL |

A key that is already in the env file and registered at Ward is kept. The app
on `localhost:5173` and Ward on `localhost:8792` are two origins, which is the
point: nothing in the flow may assume they share one. Each app's client
settings are also in the console, under Apps, then the app, then "Sign in with
Ward". To make a key by hand, run `npm run oidc-client-key --workspace=api --
<slug>` from the repo root.

## Everyday commands

```bash
docker compose logs -f ward-api   # requests, sign-ins and errors, one JSON line each
docker compose ps                 # health of both containers
docker compose up -d --build      # after changing or pulling Ward
docker compose down               # stop; accounts, keys and sessions are kept
docker compose down -v            # also delete ward.db and the signing key,
                                  # then run seed.mjs again
docker compose exec ward-api ls /data/mail   # verification mail (file transport)
```

The admin console is at http://localhost:8792/ward/console. It takes the
break-glass login from `~/.config/ward/local.env` and no other account.
