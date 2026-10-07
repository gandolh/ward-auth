---
summary: The locked calls about how an app proves it is an app — the per-app service key every /introspect call carries, why the endpoint stopped being anonymous, why a rejected key is a 401 rather than an inactive session, why the key authenticates without scoping what it may see, why Ward's own UI moved to GET /session instead of being exempted, and why an app can mail its own users through POST /notify but never read an address.
updated: 2026-10-07
---

# Decisions — app keys

Session and token mechanics are in [decisions-tokens.md](./decisions-tokens.md),
which is where introspection itself is decided; this page is only about **who is
allowed to ask**. Foundational scope calls are in
[decisions.md](./decisions.md).

## Every app authenticates to `/introspect` with its own key
_2026-09-06, built_ — `POST /introspect` requires `x-ward-app-key`: a
`wak_`-prefixed, 256-bit value Ward issues per app from the console and stores
only as `sha256`. An unkeyed caller is refused with `401
{"error":"invalid_app_key"}` before any signature verification or grant lookup.

**Why, when the token is already the credential.** The premise the original
"no client authentication, no rate limit" calls rested on — that the route is
unreachable from the internet — is false in the deployed topology. What the key
buys is three things the anonymous version could not have: an anonymous caller
is refused **before** Ward does cryptographic and database work on their
behalf; every call names the app that made it; and a leaked app configuration is
contained to one app and revoked in one console click, rather than being
indistinguishable from ordinary traffic.

**The key authenticates; it does not scope.** A keyed call still gets the whole
estate's grant map for the subject, exactly as before — sports-app learns your
atrium roles. Scoping the answer to the calling app is the obvious next move and
was **considered and declined for now**: it changes the response contract that
`@ward/client` and the app integrations are built against, and "who may ask" and
"what may they see" are two decisions. If it is revisited, the test that has to
change first is named in `api/src/routes/introspect.test.ts`.

**A bad key is a `401`, not `{"active":false}`.** The single exception to this
endpoint's one-answer rule, and the exception is the point: answering "not
active" to a misconfigured app would sign every one of that app's users out
simultaneously and silently, with a clean server log. `@ward/client` raises
`WardConfigurationError` — a **subclass** of `WardUnavailableError`, so every
app's existing fail-closed handling already catches it, while the message names
`WARD_APP_KEY`.

**The browser caller moved to `GET /session`.** Ward's own UI read `/introspect`
with the session cookie, and a key in a Vite bundle is a published string. The
tempting alternative — require a key only when there is no cookie — is
worthless and is recorded here so nobody re-proposes it: an attacker chooses
their own headers, so moving a token from a body into a `Cookie:` header is a
one-line change to a `curl` command, and a cookie-shaped exemption exempts
everybody. `/session` is safe unkeyed for a narrower reason: it reads the token
from the cookie and from nowhere else, so it grants no capability that setting
the cookie did not already grant.

**Still no rate limit**, and that conclusion is unchanged — a `429` here is read
by every app as "not live", so a limit takes the estate down rather than
degrading an attacker. What changed is that the surface is no longer anonymous,
so a limit *could* now be applied per key if one is ever wanted.

**Several live keys per app is deliberate.** Rotation is issue → deploy →
confirm the old key stopped being used → revoke. A one-key-per-app constraint
would force a window with no working key, which is an outage on every rotation.
`app_keys.last_used_at` exists to make "has it stopped" answerable, and is
stamped **at most hourly** so the estate's hot path is not also a write path.

## An app mails its own users through Ward and never reads an address
_2026-10-06 decided by the owner, 2026-10-07 built (brief 17)._ `POST /notify`
takes the app key, a subject, a subject line and plain text. Ward sends to the
verified address only when the account is active and holds a grant for the
key's app. The app never learns the address.

**Rejected: exposing verified addresses to app keys.** prm asked first: its
notification email was blocked because it holds no addresses. The short path
was an endpoint, or an introspection field, handing a keyed app the address.
Six copies of an address are six places to leak it from and six to keep
current, an app that only sends a mail does not need to know where it goes, and
introspection already leaves `email` out on purpose (`grants/resolve.ts`).

**Every refusal is one answer.** No account, disabled, unverified, no grant, a
malformed body, the rate limit: all `200 {"sent":false}`. Telling them apart
would let any app ask whether a subject has a verified address or a grant
elsewhere. The reason goes to the audit log. A transport failure is a `503`,
because it is Ward broken and the app should retry; it can only happen where
the mail would have gone, so it says no more than success does.

**Ward owns the frame.** The From name and subject prefix carry the app's
display name, and a footer says which app sent the mail and why the person gets
it. The address stays Ward's. The body schema is strict, so an app cannot set
From, Reply-To or any header, and cannot pose as another app or as Ward.

**2,000 calls per app in any rolling 24 hours.** Sized from prm, the first
caller: one call per notification row, from a sweep after each accepted batch
(one row per follower of each place with new events) and the 09:00
Europe/Bucharest reminder sweep (one row per person per favorited event
tomorrow). A heavy day at a few hundred users is under 1,000 calls. Both sweeps
are daily, so the window is a day: an hourly cap would need the same number to
cover the peak and would let a loop send 24 times as much. The limit protects
more than one app's users: every app's mail and every verification mail leave
from the same address. Counted in process; a restart clears it. Revisit when
prm passes about 1,000 verified users.

This does not reopen "no rate limit on `/introspect`". That argument was that
every app reads a `429` there as "signed out". A refused notification is one
lost mail for one app, which is exactly what this limit is for.

**Audited as `system`, labelled `app:<slug>`.** Every keyed call writes one
row, without the mail's content. `actor_kind` is a CHECK, and a new `app` kind
would mean rebuilding `audit_log` for a distinction the label already carries.
A bad key writes nothing: there is no app to name, and an anonymous caller must
not be able to write to the audit log. A loop past the cap still writes a row
per call; revoking its key is the stop that writes nothing.
