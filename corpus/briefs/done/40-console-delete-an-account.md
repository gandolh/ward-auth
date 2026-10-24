# Task 40: Console: delete an account

## Context

The owner asked on 2026-10-24, while brief 39 was being built, for a way to delete
a user from the console as well. Ward's schema expected this from the start:
`deleteUser` in [`api/src/db/users.ts`](../../../api/src/db/users.ts) exists, and
`grants`, `refresh_tokens`, `verification_tokens` and `oidc_authorizations` reference
`users (subject) ON DELETE CASCADE`. `audit_log` has no foreign keys, so the record
of a deletion outlives the account (the baseline migration says why).
`foreign_keys = ON` is set per connection.

What a deletion reaches (checked 2026-10-24):

- `/session-status` answers `active: false` for an account that is gone, so every
  app ends its Ward-originated sessions within 30 seconds.
- The provider's `findAccount` treats a missing account like a disabled one, so no
  code is exchanged for it.
- Each app's own user, and that user's data, stay. The ward link there names a
  subject that no longer exists, which no one can sign in as.
- The subject is never re-minted. The username is freed, and a new account under it
  is a new subject: a stranger to every app ([decisions.md](../../wiki/decisions.md),
  "the subject id is the contract").

## Files you OWN

- `api/src/routes/admin/accounts.ts` and its test
- `ui/src/console-api.ts` and its test, `ui/src/pages/console/AccountDetail.tsx`,
  `audit-actions.ts`
- `docs/docs/api.mdx`, `corpus/wiki/decisions-admin.md`

## What to do

1. `DELETE /console/accounts/:subject`: in one transaction, count the grants and live
   sessions, delete, and audit `user.delete` with the username and both counts.
   Answer `200 { deleted, username, grantsRevoked, sessionsRevoked }`, or `404`.
2. `deleteAccount(subject)` in the console client.
3. A danger panel, **Delete this account**, last on the account page, with a
   `Confirm` that names what goes and what stays in the apps. After it, a done
   notice with a link back to the accounts, as an app's removal has.
4. `user.delete` in the audit vocabulary, severity `authority`.

## Acceptance

- Deleting an account with grants and a session removes all three, and the counts
  are in the answer and the audit row. The same name can be created again, with a
  new subject and no grants.
- `npm run typecheck`, `npm run lint`, `npm test` pass, and the page works in a browser.

## Outcome (2026-10-24)

Built inline with brief 39, as specified. No disable is required first: an app's
removal doesn't require one either, and the `Confirm` names the cost. **One
fix on the way:** the console client typed `deleteApp`'s answer as `{ slug,
grantsRevoked }` while the route sends `{ deleted, grantsRevoked }`, so the app
page's success line read "Removed undefined and …". The type and the line now
use `deleted`; the client test's fake answer had hidden it. Checked: typecheck,
lint, all 1196 tests, and in Chromium on a scratch database. Deleting
`Cristian G` showed the done notice with focus on it. The account answered
`404` and its login `401`, and the audit row counted the 2 sessions opened by
logins just before.
