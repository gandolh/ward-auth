---
summary: Where an app's Ward integration is specified — the shared library's adoption guide and the docs site's OIDC page — plus the app-side rules for POST /session-status (30-second cache per Ward session, collapsed calls, fail closed, a 401 is a configuration error). The hand-written cookie, /introspect and app-key contract was retired 2026-10-13 (brief 30).
updated: 2026-10-13
---

# Integrating an app with Ward

An app integrates through the **shared library**, not by hand. It copies the
built library into `vendor/ward/` and builds its own screens on the library's
hooks. Two documents carry the contract:

- [shared-library/README.md](../../shared-library/README.md), the adoption
  guide: vendoring, wiring `wardAuth`, the hooks, migrating existing users,
  error codes, mail through `notifyUser`, and the gotchas the five adopters hit.
- The docs site's OIDC page
  ([docs/src/content/docs/oidc.mdx](../../docs/src/content/docs/oidc.mdx),
  served at `/oidc/` on the docs site): the issuer and its URLs, client
  registration and `private_key_jwt`, the ID token's claims, logout,
  `POST /session-status`, `POST /notify` and the environment variables.

Why the estate moved to this shape is in
[decisions-oidc.md](./decisions-oidc.md); the calls made building it are in
[decisions-oidc-build.md](./decisions-oidc-build.md).

## The app-side rules for `POST /session-status`

A session that began with "Sign in with Ward" (a **Ward-originated session**)
stores the ID token's `ward_sid` and asks `POST /ward-api/session-status`
whether that Ward session is still live and the grant still held. The library
does all of this; the rules are here so nobody loosens them by accident.

1. **Ask at most every 30 seconds per Ward session.** Cache each answer for 30
   seconds per `wardSid`, in process, and ask again only after that. Thirty
   seconds is the longest a revoked session survives (a sign-out at Ward, a
   console revoke, a password change, a removed grant), so a longer cache
   breaks the promise. Several server processes each keep their own cache.
2. **Collapse concurrent calls.** While one call for a `wardSid` is in flight,
   every other request for it waits for that answer.
3. **`{"active":false}` ends the app session.** The person is signed out of the
   app (`ward_session_ended`). Ward never says why.
4. **Fail closed when Ward cannot answer.** A timeout, a network error, any
   status other than `200` (a `404` too: Ward has no issuer configured), or a
   body that is not `{ "active": boolean }` rejects the Ward-originated session
   for that request (`ward_unavailable`). It is never read as "still live", and
   a failure is never cached as an answer. It is not a sign-out either: the
   app keeps the session row, and the session works again once Ward answers.
   Meanwhile the person can sign in with their local password.
5. **A `401 {"error":"invalid_client"}` is a configuration error, not "signed
   out".** The app's client key, `client_id` or the issuer it signs for is
   wrong, so every Ward-originated session of the app fails at once. Log it as
   a configuration error naming the client (`ward_misconfigured`) and keep
   failing closed.
6. **Sign a fresh client assertion for every call**, `aud` = the issuer. Its
   `jti` is spent on use, shared with the token endpoint.

Sessions that began with a local password are never checked against Ward, and
local sign-in never calls Ward, so an app keeps working while Ward is down.

## The retired contract

_2026-10-13, brief 30:_ the hand-written contract this page used to hold (the
`ward_session` cookie at `Path=/`, `POST /introspect`, the `x-ward-app-key`
app key and the reference client) was removed once production ran the new
flow. Its reasoning is in [decisions-app-keys.md](./decisions-app-keys.md) and
[decisions-tokens.md](./decisions-tokens.md), its history in
[../log.md](../log.md).
