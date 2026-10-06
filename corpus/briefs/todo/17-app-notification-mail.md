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
