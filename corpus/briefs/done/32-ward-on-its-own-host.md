# Brief 32: Ward on its own host, `ward.<domain>`

## Context

On 2026-10-21 the owner asked for subdomains for the apps that hold a shell or
a mailbox (`../vps-deploy` brief 14), and on 2026-10-22 added Ward. On the shared
origin a script injected into any app can call Ward's console API with the
owner's console cookie attached, so Ward is the strongest case of all. The
OIDC design (decisions-oidc.md, 2026-10-13) already made the issuer, the UI URL
and the UI's base path configuration; this brief is the move. It promotes the
todo `ward-on-a-subdomain.md`.

The routes and the deploy configuration are `../vps-deploy` brief 16: the UI at
the root of `ward.<domain>`, the API at `/ward-api` on the same host, the issuer
`https://ward.<domain>/ward-api/oidc`, `WARD_UI_URL` and `WARD_PUBLIC_ORIGIN`
the new origin, and `/ward/*` on the apex redirected to the same page there.

## What to do

1. The UI at `/`: Vite's `base`, the router's basename, and every page path
   the UI names (`/account`, `/login`, `/register`, `/verify`, `/console`).
2. `?next=`: the allowlist names Ward's own pages instead of the `/ward` root.
   On the new host `/ward-api` shares the origin with the pages and must not
   be accepted. Keep every rejection row in the test table, translated.
3. The verification mail links to `/verify` on Ward's origin.
4. The local gateway (`infrastructure/local`): the UI at the root, old
   `/ward/...` links redirected. The local issuer does not change, so the
   apps' local env files do not either.
5. Docs: the topology page, the cutover runbook (a note), the READMEs.
6. Record the call in `decisions.md`.

Not in scope: the shared library (`shared-library/`). Its tests simulate a
provider whose UI is at `/ward/login`, which is a fixture, not Ward's path, and
leaving it unchanged means no app needs a new vendored copy.

## Acceptance

- Typecheck, lint and every test pass.
- Locally: `/` goes to `/account`; `/login`, `/account`, `/console` and
  `/register` render; `/ward/...` redirects to the same page at the root; an
  OIDC authorization for a signed-out browser lands on `/login?oidc=…`.

## Outcome (2026-10-22)

Done. `ui/vite.config.ts` builds for `/`; `WARD_BASENAME` is empty;
`resolveNext` accepts only `account`, `console`, `register` and `verify` as the
first segment, and refuses the root, `/ward/...` and `/ward-api/...` as
`not_a_ward_page`; `WARD_UI_VERIFY_PATH` is `/verify`. The local gateway serves
the UI at the root with `/ward/*` redirecting, and `WARD_UI_URL` is
`http://localhost:8792`. Checked: typecheck, lint, all 1175 tests; the local
containers rebuilt and probed with curl (the routes, the redirects, discovery
still at `http://localhost:8792/ward-api/oidc`, an authorization landing on
`/login?oidc=`), and the pages rendered in Chromium with no script errors.
Production waits on the owner's deploys; the order is in
[status.md](../../wiki/status.md). brief-board is down, so nothing was posted
there.
