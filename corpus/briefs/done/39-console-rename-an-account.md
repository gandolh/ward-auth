# Task 39: Console: rename an account

## Context

The owner asked on 2026-10-24 for a username rename in Ward's console, the same day
ward-auth 0.4.0 gave the apps one ([brief 37](../done/37-library-rename-a-user.md)).
Ward already has the database half: `setUsername(db, subject, username)` in
[`api/src/db/users.ts`](../../../api/src/db/users.ts) keeps the subject, refolds the
name, and throws on a taken one. It is tested and called by nothing.

Facts (checked 2026-10-24):

- The subject is what every token, grant and app row keys on
  ([decisions.md](../../wiki/decisions.md)), so a rename moves none of them. Ward's
  login page and the console list use the username.
- An app's local user takes Ward's `preferred_username` once, at its first "Sign in
  with Ward", as a suggestion and never as a key. A rename in Ward does not reach
  the apps, and each app renames its own user (ward-auth 0.4.0).
- The console's account routes are in
  [`api/src/routes/admin/accounts.ts`](../../../api/src/routes/admin/accounts.ts):
  create, disable, enable and rotate a password, each audited in the same
  transaction, `404 account_not_found`, `409 username_taken` through
  `isUniqueViolation`. The create route's `username` schema is the rule to reuse.
- The account page
  ([`ui/src/pages/console/AccountDetail.tsx`](../../../ui/src/pages/console/AccountDetail.tsx))
  is one panel per concern. Anything that one click can't undo goes behind a
  `Confirm` that names the consequence.

## Files you OWN

- `api/src/routes/admin/accounts.ts` and its test
- `ui/src/console-api.ts` and its test
- `ui/src/pages/console/AccountDetail.tsx`, `audit-actions.ts`
- `corpus/wiki/` pages that list the console's account actions

## Files you must NOT touch

- `api/src/db/users.ts`: `setUsername` is done.
- `shared-library/`: an app's own rename is brief 37's.

## What to do

1. `POST /console/accounts/:subject/username`, body `{ username }` with the create
   route's schema. Rename and audit `user.rename` (`{ from, to }`) in one transaction.
   Answer `200 { account, changed }`. The exact same name is `changed: false` with no
   audit row; a new case of the account's own name is a change. `409 username_taken`
   when another account holds the name in any case, `404 account_not_found`, `400
   invalid_request`. Sessions are left alone: a rename is not a credential change.
2. `renameAccount(subject, username)` in the console client.
3. A **Username** panel on the account page, above Password: the field holds the
   current name, and **Rename** opens a `Confirm` saying the person signs in with the
   new name from now on and must be told, that sessions and grants stay, and that
   apps keep the name they already have.
4. `user.rename` in the audit vocabulary, severity `authority`, in the Accounts group.

## Acceptance

- Renaming `cristian` to `Cristian G`: same subject, grants and live sessions; the
  account signs in as `cristian g`, not `cristian`; one `user.rename` row.
- A name another account holds, in any case, answers `409` and changes nothing.
- The same name answers `changed: false` and writes no audit row.
- `npm run typecheck`, `npm run lint`, `npm test` pass, and the page works in a browser.

## Outcome (2026-10-24)

Built as specified, inline, with these choices:

- `POST /console/accounts/:subject/username` reuses the create route's
  `username` schema, so a bad name is `400 invalid_request` as it is on create.
  It compares the trimmed name with the stored one for the no-op.
- The Username panel sits above Password. Rename stays disabled until the
  trimmed name differs, and opens a `primary` `Confirm`, because a rename can
  be renamed back.
- The `user.rename` audit row is `{ from, to }`, severity `authority`.
- Checked: typecheck, lint, all 1196 tests, and the console in Chromium on a
  scratch database. A taken name (`BOB`) was refused with the console's
  `username_taken` message. A rename to `Cristian G` updated the heading and
  wrote one audit row. Ward's `/login` then took `cristian g` and `CRISTIAN G`
  and refused `cristian`.
