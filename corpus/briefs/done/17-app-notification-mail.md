# Brief 17 — Apps can mail their own users through Ward, without seeing an address

## Context

Decided by the owner on 2026-10-06, answering public-resource-map's blocked email
channel (prm brief 05: "Email blocked on Ward, prm holds no addresses"). Of the two
ways out, the owner chose **Ward sends the mail**; Ward does not expose verified
addresses to apps.

prm keys users by Ward's opaque `subject` and has `notification.emailed_at` ready.
Ward already has the pieces: `api/src/mail/transport.ts` (SMTP, or `file` mode
writing `.eml` files), `auth/app-key.ts` (`x-ward-app-key`, checked first on every
app call, as `routes/introspect.ts` does), and the grants model.

## Files you OWN
- `api/src/routes/notify.ts` (new) and its test; the route's registration in `app.ts`
- `api/src/mail/templates.ts` (a wrapper for app-sent mail)
- `client/` (`@ward/client`): a `sendNotification` method and its test
- `corpus/wiki/integrating.md` (the integration contract), `corpus/wiki/decisions*.md`, `corpus/log.md`

## Files you must NOT touch
- The registration and verification mail flows (brief 07), except to share the
  transport.

## What to do
1. `POST /notify`, app key required and checked first (`401 invalid_app_key` as in
   introspect). Body: `{ subject, mailSubject, text }`, plain text, with sane
   length limits.
2. Ward sends only when the user exists, is active, has a **verified** address, and
   **holds a grant for the calling app**. An app can mail its own users and nobody
   else. Every refusal is the same `{ sent: false }` (don't tell an app which of
   those failed, for the same reason introspect has one answer), and every call is
   written to the audit log with the app's slug.
3. Ward wraps the app's text in a fixed frame: the app's display name in the From
   name and subject prefix, and a footer saying which app sent it and why the user
   gets it. The app never sets From, Reply-To or headers.
4. A per-app rate limit (pick a number, say why) so one buggy app cannot spam the
   estate.
5. `@ward/client`: `sendNotification({ subject, mailSubject, text })` returning
   `{ sent: boolean }`, throwing `WardUnavailableError` on network failure so the
   caller can retry.
6. Document the endpoint in `integrating.md` and record the decision (rejected:
   exposing verified addresses to app keys).

## Acceptance
- Tests: no key 401; a subject without the app's grant gives `{ sent: false }`
  and no mail; an unverified address gives `{ sent: false }`; a granted, verified
  user gets one `.eml` in `file` mode whose From and footer name the app.
- The rate limit refuses past its threshold, and the audit log records each call.
- Ward's test suite and typecheck pass.

## Outcome (2026-10-07)

Shipped as specified in `0f8bd20`, with one addition.

- `POST /notify` is `api/src/routes/notify.ts`, registered in `app.ts`. The app
  key is checked in `onRequest`, before the body is parsed. The body is strict:
  `subject` 1 to 64 characters, `mailSubject` one line up to 200, `text` up to
  20,000. Any other key is a refusal.
- Ward sends only to an active account with a verified address that holds a
  grant for the key's app. Every refusal is the same `200 {"sent":false}`.
- The addition: a transport failure is `503 {"error":"mail_unavailable"}`, not
  a refusal, so `@ward/client` raises `WardUnavailableError` and the app retries.
- The frame is `mail/templates.ts#appNotificationMail`: From `<App> via Ward`
  at Ward's address, subject `[<App>] …`, and a footer after a `-- ` line.
  `mail/transport.ts` gained an optional From display name. Verification mail
  does not use it and is unchanged.
- Rate limit: **2,000 calls per app in any rolling 24 hours**, in process. prm
  makes one call per notification row, from a sweep after each accepted batch
  and the 09:00 reminder sweep. A heavy day at a few hundred users is under
  1,000 calls. Both sweeps are daily, so a day window covers the peak and stops
  a loop that an hourly cap would let send 24 times as much. prm's reminder
  rows are per person per event, not per person; the sizing counts rows.
- Every keyed call writes an audit row, actor `system`, label `app:<slug>`,
  action `notify.sent`, `notify.refused` (with the reason) or `notify.failed`.
- `@ward/client` has `sendNotification({ subject, mailSubject, text })`
  returning `{ sent: boolean }`, with a 15 second default timeout.
- Also updated: the client README and the HTTP table in `docs/`.

Verified: 946 tests pass (46 new), typecheck and lint are clean. The local
container was rebuilt. `POST /ward-api/notify` answered `401` with no key, and
`{"sent":false}` with prm's local key and an unknown subject, writing a
`notify.refused` row labelled `app:prm`.
