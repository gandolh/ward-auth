# Brief 18 — Ward becomes an OpenID Connect provider

## Context

Decided by the owner on 2026-10-13: every app keeps its own accounts, and
"Sign in with Ward" is an OIDC authorization code flow with PKCE against Ward.
Read [decisions-oidc.md](../../wiki/decisions-oidc.md) first. It is the spec
for this brief, and it records what was rejected.

Ward is Fastify on SQLite (`api/`), holds one Ed25519 signing key
(`api/src/tokens/`), and its React UI has the login page (`ui/src/pages/Login.tsx`)
that already says "Continue to <App>". Apps are rows in the `apps` table
(`api/src/db/apps.ts`), and grants are `(subject, app, role)`
(`api/src/db/grants.ts`). A Ward sign-in is a refresh-token family whose id is
the `sid` ([decisions-tokens.md](../../wiki/decisions-tokens.md)).

Use [`oidc-provider`](https://github.com/panva/node-oidc-provider). Do not
write the protocol by hand.

## Files you OWN

- `api/src/oidc/**` (new): provider configuration, the SQLite adapter, the
  account lookup, the interaction routes, and their tests
- `api/src/app.ts` (mounting), `api/src/config.ts` (new settings),
  `api/src/db/migrations/` (new migration, appended at the end of the static list)
- `api/src/db/apps.ts` and the console's app routes and panel, for client
  metadata (redirect URIs, client authentication)
- `ui/src/pages/Login.tsx` and `ui/src/lib/**`, for the interaction step
- `infrastructure/local/seed.mjs` and `infrastructure/local/README.md`
- `.env.example`, `docs/src/content/docs/` (a new OIDC page)
- `corpus/wiki/decisions-oidc.md` (record the calls this brief settles),
  `corpus/wiki/open-questions.md`, `corpus/log.md`

## Files you must NOT touch

- `/introspect`, `/session`, `/refresh`, `/logout` and the cookie sign-in the
  four apps use today. They keep working until the cutover (brief 27).
- `client/`. It is the reference for today's contract.

## What to do

1. **Mount the provider behind a prefix.** Caddy strips `/ward-api` before
   requests reach Ward. The issuer is an external URL from config
   (`WARD_OIDC_ISSUER`), and the provider must emit that URL, not the internal
   one, in discovery, in `iss` and in every endpoint it advertises. The same bug
   class has hit this repo once already ([integrating.md](../../wiki/integrating.md)
   rule 2).
2. **Persist everything in SQLite.** The default adapter is in-memory, and a
   restart would lose codes and grants. Write an adapter on the existing
   better-sqlite3 connection with its own migration and an expiry sweep.
3. **Sign with Ward's existing Ed25519 key.** Feed it to the provider's JWKS.
   Discovery and the JWKS must resolve behind the prefix.
4. **Clients are apps.** `client_id` is the app slug. Redirect URIs and
   post-logout URIs are per app and per environment (the dev Vite origin and
   the production path), edited in the console and written by the local seed.
   Only the authorization code grant with PKCE (`S256`). No implicit flow, no
   password grant, no dynamic registration.
5. **Choose the client authentication method and record why.** Ward stores app
   keys only as `sha256` ([decisions-app-keys.md](../../wiki/decisions-app-keys.md)),
   and `client_secret_basic` compares plaintext. Prefer `private_key_jwt`: each
   app holds a private key in its env, and Ward stores only the public JWK.
   Ward then holds no app secret at all. If `private_key_jwt` turns out to be
   unworkable, say why and pick the next best option. Ship a script that
   generates an app's key pair and prints the env line plus the public JWK for
   the console.
6. **The login step is Ward's own session.** The interaction checks Ward's
   refresh cookie first. A live Ward session completes the interaction without
   a password prompt. Otherwise the person sees `Login.tsx`, headed with the
   client's display name, and signing in there creates an ordinary Ward
   session. First-party clients never see a consent screen. Ward's own refresh
   family is the authority on "signed in at Ward". Keep the provider's own
   session as short-lived as the library allows, and describe what it still
   does.
7. **Grant check.** Finish the authorization only if the account holds a grant
   for the client's app. Otherwise return `access_denied` to the redirect URI.
   A disabled account is refused the same way.
8. **Claims.** The ID token carries `sub` (the Ward subject, unchanged),
   `preferred_username`, `ward_sid` (the refresh family id) and `ward_role`
   (the grant's role). Email is never included.
9. **Logout.** Support RP-initiated logout for apps that want "sign out of Ward
   too", which revokes the Ward family. Ward's own sign-out still works as
   today.
10. **Nothing may assume Ward shares the app's origin.** No `Path=/` cookies
    the flow depends on, and no `Origin` checks that equate Ward with the app.
    The local container on `localhost:8792` must complete a full flow for an
    app on `localhost:5173`.

## Acceptance

- Discovery, the JWKS, authorize, token and end-session work behind the
  stripped prefix, and every advertised URL uses the configured issuer (a test
  asserts this).
- End to end in tests: code + PKCE, then an ID token whose signature verifies
  against Ward's JWKS with `alg` pinned to `EdDSA`, with `sub`, `ward_sid` and
  `ward_role`.
- Each of these gives `access_denied`: no grant, a disabled account, and a
  wrong or unregistered redirect URI.
- With a live Ward session, the flow completes without a password prompt.
- A restart in the middle of a flow does not lose the code.
- The local seed registers each app as a client with its dev redirect URI.
  Docs describe the new env variables without naming any domain.
- Ward's test suite, typecheck and lint pass.

## Outcome (2026-10-13)

Shipped. `oidc-provider` 9.12.2 is mounted under `/oidc` behind the stripped
`/ward-api` prefix when `WARD_OIDC_ISSUER` (ending in `/oidc`) and
`WARD_UI_URL` are set. With neither set, nothing is mounted and production
behaves as before. Codes and grants persist in SQLite (migration
`20261013000000-oidc`). Clients authenticate with `private_key_jwt` only;
`npm run oidc-client-key --workspace=api -- <slug>` prints the app's key line
and the public JWK for the console. The ID token carries `sub`,
`preferred_username`, `ward_sid` (the refresh family) and `ward_role`. Both
open questions are settled in decisions-oidc.md.

Deviations:
- A wrong or unregistered redirect URI gets Ward's own 400 page, not
  `access_denied`, because redirecting an error to an unregistered URI is an
  open redirect.
- openid-client 6 signs client assertions as `Ed25519`, so Ward accepts both
  `EdDSA` and `Ed25519` there. ID tokens stay `EdDSA` only.
- Docker was not available in the session, so the container was not rebuilt.
  The full flow was run with openid-client 6.8.8 against Ward in production mode
  behind a prefix-stripping proxy.

Verified by the controller: 1009 tests, typecheck, lint, build and corpus lint
clean.
