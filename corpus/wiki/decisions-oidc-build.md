---
summary: The engineering calls made while building the 2026-10-13 OIDC redesign — private_key_jwt client authentication, Ward's refresh family as the authority over oidc-provider's own session, the prefix, logout and unregistered-redirect behaviour (brief 18), and the shared library's build calls (brief 20).
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
