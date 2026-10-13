---
summary: The engineering calls made while building the 2026-10-13 OIDC redesign — private_key_jwt client authentication, Ward's refresh family as the authority over oidc-provider's own session, the prefix, logout and unregistered-redirect behaviour (brief 18), the session-status endpoint and `/notify`'s client authentication (brief 19), the shared library's build calls (brief 20), and its Ward half — callback path, link binding, fail-closed check, fresh sign-in for a first password (brief 21).
updated: 2026-10-13
---

# Decisions — building the OIDC redesign

The design is [decisions-oidc.md](./decisions-oidc.md). These are the calls
the briefs settled while building it.

## Apps authenticate as clients with `private_key_jwt`
_2026-10-13, brief 18_ — Each app holds an Ed25519 private key in its own env
(`WARD_OIDC_CLIENT_KEY`, made by `npm run oidc-client-key`) and signs a client
assertion (`alg` `EdDSA` or `Ed25519`, since `openid-client` 6 sends the
latter; `aud` the issuer; fresh `jti`). Ward stores only the
public JWK on the app's row and refuses one carrying `d`. Ward holds no app
secret at all. `api/src/oidc/client-auth.ts` checks the same assertion outside
the provider, sharing its replay markers, for brief 19's endpoints.

**Rejected: `client_secret_basic`** (Ward needs the plaintext, which the app
keys' sha256 design refused), and **a custom check of a hashed secret** (not a
method `openid-client` speaks, so every app would carry custom code).

## Ward's refresh family decides; the provider's session only hands off
_2026-10-13, brief 18_ — The provider asks for the login step on **every**
authorization. That step reads Ward's refresh cookie, so it lives under
`/refresh` (`/ward-api/refresh/oidc/<uid>`), where the cookie already goes. It
checks the account is active and holds a grant, and grants `openid` itself. A
code exchange re-checks the family, the account and the grant, so a sign-out
inside the code's minute yields no token. The provider's session lives ten
minutes, one interaction's span: a shorter one can expire under an interaction
and strand it. It carries the settled account from the step to the resumed
authorization and to the code exchange, since codes expire with it. It never
answers "signed in" by itself, and nothing reads its `sid`.

**Rejected: letting a live provider session skip the step.** Then a Ward
sign-out or revoke would leave apps able to sign in silently for as long as the
provider's session lived. One cost is accepted: `prompt=none` always answers
`login_required`.

## Built: the prefix, logout, and an unregistered redirect URI
_2026-10-13, brief 18_ — `WARD_OIDC_ISSUER` is optional: unset, nothing is
mounted, so a deploy that lacks it keeps today's routes. The issuer must end in
`/oidc`, and what precedes it is the stripped prefix. Each request's path, mount
and forwarded host are rewritten from config before the provider sees it.
RP-initiated logout revokes the family named in a validated `id_token_hint`'s
`ward_sid`; without a hint nothing at Ward is revoked. An unregistered redirect
URI gets Ward's own error page, not `access_denied`. Redirecting an error to an
unregistered URI is an open redirect, and the spec forbids it.

## Apps ask `POST /session-status`; `/notify` takes the same credential
_2026-10-13, brief 19_ — The pull in decisions-oidc.md ("Ward-originated
sessions still end within 30 seconds") is `POST /ward-api/session-status`, the
OIDC replacement for `/introspect`. The body carries the client assertion in
the standard form for `private_key_jwt` (`client_assertion_type` and
`client_assertion`) beside `wardSid` and `subject`; `aud` is the issuer. An app
needs no access token and no app key. The answer is `{active:true, role}` or
`{active:false}`, and **every no is the same bytes**: a revoked, lapsed or
unknown family, a disabled account, a subject that is not the family's, no grant
in the calling client's app, a malformed body. The app is always the
assertion's client, never one named in the body. It asks what `findAccount`
asks at code exchange, so a session that could not be signed in cannot be kept.

**A bad assertion is `401 {"error":"invalid_client"}`**, the one exception, for
the reason `/introspect` made its bad app key one: a misconfigured client must
not read as an app full of signed-out people. A body that is not JSON is read as
no body, so it is the same `401`. Without `WARD_OIDC_ISSUER` the route is not
mounted and answers `404`, like the provider. **Not audited**, as `/introspect`
is not: one row per session per 30 seconds would bury the rows an operator
needs. A refused assertion is logged at `warn` with its reason. No rate limit,
for `/introspect`'s reason.

`/notify` accepts `client_assertion_type` and `client_assertion` in its body as
well as the `x-ward-app-key` header, and a request that sends the header is
judged by it alone. The assertion lives in the body, so it is checked after the
body parses (a bad app key is still refused before). A bad assertion is the same
`401 invalid_client`; no credential at all keeps `invalid_app_key`. Audit rows
name the credential (`keyId`, or `auth: "client_assertion"`) and never hold it.
The app key and `/introspect` retire in brief 27.

## The local half's build calls
_2026-10-13, brief 20_ — Settled while building `shared-library/`:
- **Sessions:** the cookie holds 32 random bytes, the row holds their SHA-256.
  Idle expiry 14 days, sliding; absolute 30 days, Ward's refresh-family
  ceiling, so both kinds of session age out on one clock. The sliding expiry
  is written at most hourly, because a write on every request turns page loads
  into database writes for nothing.
- **Tables:** `auth_users`, `auth_sessions`, `auth_migrations`, applied by the
  library from an append-only migration list. Migration 1 already has a
  nullable `password_hash` and the session row's `origin` and `ward_sid`
  (tied by a CHECK), because SQLite cannot relax a column without a table
  rebuild and brief 21 needs all three.
- **One store for two drivers:** a structural handle type that better-sqlite3
  and `node:sqlite` both satisfy, positional parameters, and `SAVEPOINT`
  transactions, so the store also nests inside an app's own transaction.
- **The guard** is the plugin's `onRequest` hook on the instance the app
  registers it on (it escapes encapsulation the way `fastify-plugin` does), so
  the app must register it before its own routes. Its extension hook,
  `validateSession`, is where brief 21 puts the 30-second check; a validator
  that throws fails closed.
- **The bundler is Rollup with TypeScript's own transpiler**, plus
  rollup-plugin-dts for the two `.d.ts` files. **Rejected: esbuild**, which
  strips every comment that is not a licence, and the comments are where this
  code says why.

## The Ward half's build calls
_2026-10-13, brief 21_ — Settled while adding "Sign in with Ward" to
`shared-library/` (0.2.0). The adoption guide is `shared-library/README.md`.
- **The callback lives under the app's API prefix:**
  `<api prefix>/auth/ward/callback`, not brief 18's `<ui base>auth/ward/callback`.
  The session cookie is scoped to the API prefix and a link callback must see
  it. The dev server and Caddy already route that prefix, so no proxy gains a
  rule. The plugin refuses at boot a redirect URI that is not its route under
  `cookiePath`. The seed writes the new URI and drops the old one.
- **Starts are POSTs that answer `{ url }`.** A link changes the account, so it
  must not be a cross-site `GET`. The hook then navigates, and can show
  `ward_unavailable` without leaving the page.
- **The flow cookie** (`<cookie>_ward`, callback path, ten minutes) holds
  state, nonce and verifier. A link or reauthentication also records the
  starting session's hash, and the callback finishes only for that session,
  so a planted flow cannot link a victim's Ward account to an attacker's user.
- **The check fails closed but keeps the row.** Ward down refuses a
  Ward-originated session as `ward_unavailable`. The row stays, so the session
  resumes when Ward answers. Only answers are cached, never failures. `active:
  false`, or a user unlinked since, ends the session. A plugin without Ward
  configured refuses Ward-originated sessions rather than leaving them
  unchecked.
- **A first local password needs a fresh Ward sign-in:** a Ward-originated
  session under ten minutes old. Reauthentication (`prompt=login`) makes one.
  An open session on a shared machine cannot become a permanent password.
- **Unlink ends the user's Ward-originated sessions.** Without the link there
  is no subject to ask Ward about.
- **The ID token is kept on the session row** as the logout hint. Ward accepts
  an expired hint (oidc-provider ignores `exp` on it), so it outlives the
  token's hour.
- **Errors from the round trip are codes in the redirect** (`?ward_error=`).
  The provider's own codes, `access_denied` first, pass through. The client
  reads the code once and removes it from the address bar.
- **The library's tests run a real Ward in-process** behind a fetch that
  strips the prefix. They import `api/` by computed path, as dev-only code
  that no bundle reaches.

