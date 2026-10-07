---
summary: The contract every consuming app implements by hand — the five things a Ward integration must get right (algorithm pinning, the base path, the app key, the 30-second cache, failing closed), the exact environment variables, the shape of the local ward module each app writes for itself, and POST /notify, which mails an app's own user without the app seeing the address.
updated: 2026-10-07
---

# Integrating an app with Ward

Each app **writes its own Ward client**. There is no shared npm package in any
app's dependencies, by decision (2026-09-06): the apps are separate checkouts
that `vps-deploy` rsyncs and `npm ci`s independently, and every mechanism for
sharing one package across them — a registry, a committed tarball, a git
dependency — costs more in build machinery and deploy authentication than the
~200 lines it saves.

The cost is real and is accepted with eyes open: this is **security code,
duplicated five times**. This page is the mitigation. It is the contract all
five implementations are written against, and
[`client/`](../../client/) in this repo stays as the **tested reference
implementation** — 58 tests, not shipped to anything, kept so that "what should
this do" has one answer and a new app has something to copy from rather than
reinvent.

> If you are about to change any behaviour on this page, change it here first,
> then in `client/`, then in all five apps. A change made in one app only is a
> divergence nothing will detect.

## The five things that must be right

**1. Pin the algorithm.** Pass `algorithms: ["EdDSA"]` on every verification,
as a literal — never derived from the token's own `alg` header. Without it a
verifier accepts whatever the resolved key supports, which is the
`alg`-confusion class: `alg: "none"`, and `alg: "HS256"` with the *public* key's
own bytes handed over as the HMAC secret. A public key is by definition
something an attacker already has.

**2. The base path is `/ward-api`, and it is not optional.** Ward is behind
Caddy at `handle_path /ward-api/*`. The JWKS is
`https://gandolh.ro/ward-api/.well-known/jwks.json`. This has already been got
wrong once: an earlier default of `""` resolved to a path nothing serves, which
would have made every app fetch a 404 for Ward's public key and reject every
token in the estate on the deploy that shipped it.

**3. Send the app key on every introspection.** Header `x-ward-app-key`, value
from `WARD_APP_KEY`. Ward refuses an unkeyed call — see
[decisions-app-keys.md](./decisions-app-keys.md). It is a **server-side
secret**: it must never reach a browser bundle or any client-side config.

**4. Cache the introspection answer for 30 seconds, per token, and collapse
concurrent calls.** Thirty seconds is the number the whole revocation design
rests on ([decisions-tokens.md](./decisions-tokens.md)) — it is how long a
revoked session stays usable, and it must not be raised in production. Keying
per token, not per subject, matters: each token is verified independently and
the cache must only ever hold an answer received for that exact value.

**5. Fail closed, always.** Ward unreachable, a timeout, a `500`, a `401`, a
body that does not match the contract — every one of these **rejects the
request**. Never fall back to a stale cache entry, and never let any of them
resolve as "not signed in", which a caller could mistake for an ordinary
signed-out response. **This covers the key-set fetch too, not only
introspection.** Verifying a token fetches the JWKS whenever the cache is empty
or older than ten minutes: at boot, and ten minutes into an outage. A failed
fetch is Ward unavailable. Only "no key matches this token's `kid`" (or
"several do") is the token's fault. `@ward/client`'s `verifyAccessToken`
classifies it this way since 2026-10-04; atrium and prm did it first.

Point 5 has one refinement worth implementing: treat a `401` as its own error
type whose message names `WARD_APP_KEY`. It still fails closed, but a
misconfigured deployment must be distinguishable in a log from Ward being down,
because the fix is completely different and only one of them resolves by
waiting.

## The endpoints

| | |
|---|---|
| `GET /ward-api/.well-known/jwks.json` | Ward's public keys. Cache ~10 minutes. No key needed. |
| `POST /ward-api/introspect` | `{ accessToken }` + `x-ward-app-key`. **Always `200`** except `401` for a bad key. |
| `POST /ward-api/notify` | Mail one of your users. See [Mailing a user](#mailing-a-user-post-notify) below. |
| `GET /ward-api/session` | Cookie-authenticated. **Ward's own UI only** — an app has no use for it. |
| `/ward/login?next=…` | Where an app sends somebody who is not signed in. |

The access token arrives in the **`ward_session` cookie**, `Path=/`, which the
browser sends to every app on the origin automatically — that is the concrete
payoff of the one-origin decision, and it is why atrium can delete its
`?token=` query-string fallback for `<img>` tags.

Introspection answers `{ active: false }` or
`{ active: true, subject, username, grants }`. `grants` is
`{ "atrium": ["admin"], … }` — **the whole estate's**, not just yours. Check
membership in `grants[yourSlug]`; never compare the object for equality, and
never assume a role you did not find means the account is unknown.

## The environment contract

Every consuming app sets exactly these three:

```
WARD_PUBLIC_ORIGIN=https://gandolh.ro   # bare origin, no trailing slash
WARD_API_BASE_PATH=/ward-api            # explicit; see point 2
WARD_APP_KEY=wak_…                      # secret; issued per app from the console
```

`WARD_APP_KEY` is issued in Ward's console on the app's own page, under
*Service keys*. It is shown **once** and cannot be read back — Ward stores only
a digest. If it is lost, issue a new one and revoke the old one; that is also
the rotation procedure, and an app may hold several live keys at once precisely
so a rotation needs no window where it has none.

`vps-deploy` declares `WARD_APP_KEY` as a required secret against **each app's
own stack** (`WardStack.identityFor(consumer)`), so it is read from
`secrets/<app>.env` and a preflight names the right file when it is absent.

## The shape each app writes

One module, no framework dependency in the core of it:

```
<app>/…/ward/
  claims.ts      the constants — EdDSA, "ward-estate", 5s skew, 30_000ms
  verify.ts      jwks resolver + verifyAccessToken(token)
  introspect.ts  the cached, stampede-collapsing POST /introspect
  client.ts      verify → introspect → authenticate(cookieHeader)
  guard.ts       the framework binding (Fastify preHandler, Nest guard, …)
```

Copy it from [`client/src/`](../../client/src/) and adapt the last file. The
first four are the same in all five apps; the fifth is the only part that is
genuinely per-app, which is also the honest reason a shared package bought less
here than it looked like it would.

## Authorization is a grant, not an account

Holding a Ward account confers **nothing**. An app must guard on a grant:

```ts
const session = await ward.authenticate(request.headers.cookie);
if (!session.grants["atrium"]?.includes("admin")) throw forbidden();
```

A valid, live Ward session with no grant for your app is a **403**, not a 200.
That is the estate's actual security boundary
([decisions-accounts.md](./decisions-accounts.md)) and it is what lets prm keep
public self-registration without exposing the other four apps. Every
integration owes a test that asserts exactly this.

Role strings are opaque and Ward never interprets them — they mean whatever the
owning app decided. Ward stores the triple `(subject, app, role)` and nothing
more.

## Keying app rows

Each app keeps its own tables and keys them on the **subject** — a stable,
opaque identifier that is never recycled. Not the username, which a person can
change, and not an email, which is Ward's business and not yours.

## Mailing a user: `POST /notify`

An app holds no addresses, so Ward sends the mail for it
([decisions-app-keys.md](./decisions-app-keys.md)). Built 2026-10-07.

```
POST /ward-api/notify
x-ward-app-key: wak_…
content-type: application/json

{ "subject": "<Ward subject>", "mailSubject": "<one line>", "text": "<plain text>" }
```

- `subject`: the recipient's subject, 1 to 64 characters.
- `mailSubject`: one line, trimmed, 1 to 200 characters, no control characters.
- `text`: plain text, at most 20,000 characters, not blank. Tab, LF and CR
  are the only control characters allowed; CRLF becomes LF.
- **No other key.** `from`, `replyTo`, `headers` or anything else is refused.

| Answer | Meaning | What the app does |
|---|---|---|
| `200 {"sent":true}` | Ward handed the mail to its transport. | Mark it sent. |
| `200 {"sent":false}` | Refused. One answer for: no such account, disabled, no verified address, no grant for your app, a malformed body, your rate limit. | Mark it done. Final; never retry. |
| `401 {"error":"invalid_app_key"}` | The key, checked before the body is read. | Fix `WARD_APP_KEY`. |
| `503 {"error":"mail_unavailable"}` | Ward could not send. | Retry on the next run. |
| anything else, or no answer | Ward is down or unreachable. | Retry on the next run. |

Ward sends only to an active account with a verified address that holds **a
grant for the key's app**: your own users, nobody else. The person sees From
`<App name> via Ward` at Ward's address, Subject `[<App name>] <mailSubject>`,
your text, then an English footer naming your app and why they get it.

**Rate limit: 2,000 calls per app in any rolling 24 hours**, counted in
Ward's process (a restart clears it). Every keyed call counts, refused or
sent; a call the limit refuses does not. Past it the answer is
`{"sent":false}`. Why: prm's two daily sweeps make one call per notification
row, under 1,000 on a heavy day at a few hundred users, and a day window stops
a loop that an hourly cap would let send 24 times as much.

Every keyed call writes an audit row (`notify.sent`, `notify.refused` with the
reason, or `notify.failed`; label `app:<slug>`; target the subject), never the
content. That is where an operator finds why a mail was refused.

The reference is `client/src/notify.ts`: `ward.sendNotification({ subject,
mailSubject, text })` resolves `{ sent: boolean }`, throws
`WardConfigurationError` (a `WardUnavailableError` subclass) on a `401`, and
`WardUnavailableError` for the last two rows, a timeout (15 s default)
included. Call it from a background sweep, never in a request. A timeout is
ambiguous: Ward may have sent anyway, so a retry can deliver twice.
