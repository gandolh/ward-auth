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
   `admin` on each, and writes a fresh app key, `WARD_PUBLIC_ORIGIN` and
   `WARD_API_BASE_PATH` into each app's local env file (table below). It asks
   for the owner account's username and password, or reads
   `WARD_OWNER_USERNAME` and `WARD_OWNER_PASSWORD`, and stores neither. It is
   safe to re-run: keys that still work are kept and the password is not reset.

## Signing in to an app

Start the app with its usual `npm run dev` and use its own sign-in. Each app's
dev server serves the app under the path it has in the deploy and forwards
`/ward` and `/ward-api` to this container, so the browser sees one origin the
way it does behind Caddy, and Ward sends you back into the app afterwards.

| App | Open | Env files `seed.mjs` writes |
| --- | --- | --- |
| atrium | http://localhost:5173/atrium/ | `atrium/.env` |
| newspapper | http://localhost:4321/newspapper/ | `newspapper/.env` |
| prm | http://localhost:5173/prm/ | `public-resource-map/.env` |
| sports-app | http://localhost:5173/sports-app/ | `sports-app/.env` |
| imbatranimOS | http://localhost:5173/imbatranim-os/ | `imbatranimOS/.env`, `imbatranimOS/apps/backend/.env` |

Each app's own `.env.example` has the other dev values that layout needs (the
base path and API URL); imbatranimOS keeps them in `apps/core/.env.development`.

Sessions last 15 minutes and no app renews one yet. When an app starts treating
you as signed out, open `/ward/account` on its dev server, or
http://localhost:8792/: the account page renews the session from the 30-day
refresh cookie.

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
