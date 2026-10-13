# Brief 19 — Apps ask Ward whether a Ward session is still live

## Context

Revoke-everywhere stays for sessions that began with Ward
([decisions-oidc.md](../../wiki/decisions-oidc.md), "Ward-originated sessions
still end within 30 seconds"). An app that signed someone in through Ward keeps
the ID token's `ward_sid` on its own session row and asks Ward at most every 30
seconds whether that Ward session is live and the grant still held. That
replaces what `/introspect` does today, without the app holding Ward's access
token.

`POST /notify` (brief 17) also moves to client authentication, so an app needs
one credential for everything it asks Ward.

Depends on brief 18 (client authentication).

## Files you OWN

- `api/src/routes/session-status.ts` (new) and its test, registered in `app.ts`
- `api/src/routes/notify.ts` and its test (accept client authentication as
  well as the app key)
- `api/src/oidc/` only to reuse client authentication, not to change it
- `docs/src/content/docs/`, `corpus/wiki/decisions-oidc.md`,
  `corpus/wiki/decisions-app-keys.md`, `corpus/log.md`

## Files you must NOT touch

- `/introspect` and the app-key path. They retire in brief 27, not here.

## What to do

1. `POST /session-status`, authenticated the way brief 18 authenticates a
   client (for `private_key_jwt`, a client assertion). Body:
   `{ wardSid, subject }`. Answer `200 { active: boolean, role?: string }`.
   `active` is true only when the family is live, the account is active, the
   subject matches the family, and the account still holds a grant for the
   calling client's app. Every "no" is the same `{ active: false }`, as
   `/introspect` does today. A bad client credential is `401`.
2. Audit each call the way `/introspect` is audited, or say why not.
3. `/notify` accepts client authentication. The app-key header keeps working
   until brief 27.
4. Write the app-side rules into the OIDC docs page. They are the same as
   [integrating.md](../../wiki/integrating.md) rules 4 and 5: cache 30 seconds
   per `wardSid` and collapse concurrent calls; fail closed on any error,
   timeout or malformed body; a `401` is its own error naming the client
   configuration.

## Acceptance

- Tests: sign-out, a console revoke, a password change, a removed grant and a
  disabled account each turn `active` to false. A mismatched subject is false.
  A missing or bad client credential is `401`.
- `/notify` works with client authentication and still works with the app key.
- Ward's test suite, typecheck and lint pass.
