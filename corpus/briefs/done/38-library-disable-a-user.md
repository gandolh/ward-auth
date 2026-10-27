# Task 38: Library: switch off a local user

## Context

Promoted 2026-10-23 from the todo
`library-username-shaping-and-rename` (deleted when brief 38 landed),
third bullet. Briefs 36 and 37 take the other two.

satchel lost its "lost grant locks you out" rule in the Wave C adoption (brief 26).
A local user keeps working after their Ward grant is removed, and an app has no way
to stop them short of deleting rows by hand. `Accounts`
([`core/accounts.ts:82`](../../../shared-library/src/core/accounts.ts)) has no
disable, and `auth_users`
([`store/migrations.ts`](../../../shared-library/src/store/migrations.ts)) has no
column for it.

Every refusal in Ward itself is one answer: no account, disabled, unverified and no
grant all look the same from outside ([decisions-app-keys.md](../../wiki/decisions-app-keys.md)).
The library keeps that rule: `verifyCredentials` already returns `undefined` for
every failure at one cost.

Run it after briefs 36 and 37: they share `CHANGELOG.md`, the version and some files, so build them one at a time.

## Files you OWN

- `shared-library/src/store/migrations.ts` (a **new** migration appended at the end;
  never edit or reorder an existing one)
- `shared-library/src/store/types.ts`, `store/sqlite.ts`, `store/sqlite.test.ts`
- `shared-library/src/core/accounts.ts`, `core/accounts.test.ts`
- `shared-library/src/ward/identities.ts`, `ward/identities.test.ts`
- `shared-library/README.md`, `CHANGELOG.md`, `package.json` (version)

## Files you must NOT touch

- Any app's `vendor/ward/`. satchel getting its rule back (calling `disableUser` when
  a grant goes) is a satchel brief after this ships.
- `fastify/plugin.ts` routes: there is no self-service or HTTP route for this. An app
  calls it from its own code.

## What to do

1. Migration: `disabled_at INTEGER` (NULL = active) on `auth_users`.
2. `AuthStore.setDisabled(userId, disabledAt | null, now)`, and `UserRecord` carries
   `disabledAt`. `AuthUser` gains `disabled: boolean`.
3. `Accounts.disableUser(userId)`: stamps the time and ends every session the user
   holds. `Accounts.enableUser(userId)` clears it.
4. A disabled user is refused everywhere a user gets in, with the same answer as an
   unknown one:
   - `verifyCredentials` returns `undefined`, still at one scrypt cost;
   - `resolveSession` returns `undefined` for a session whose user is disabled (in
     case one was minted in a race);
   - `startSession` refuses (throw; the callers never call it for a disabled user);
   - `userForSignIn` on a linked, disabled user refuses, and the Ward callback lands
     on the attempt's page with the same `ward_error` a refused sign-in gets now. It
     must not fall through to creating a new user for that subject.
5. Tests for each refusal, for the timing rule (a disabled user's wrong and right
   password cost the same), and that enabling restores access with the old password.
6. Minor version bump; the CHANGELOG notes the migration (applied by
   `createSqliteStore`) and that a custom store must implement `setDisabled`.

## Acceptance

- After `disableUser`, the user's open session stops working on its next request,
  password login fails like a wrong password, and "Sign in with Ward" for the linked
  subject fails without creating a second user.
- After `enableUser`, all three work again.
- Existing databases migrate on open with every user active.
- `npm run typecheck`, `npm run lint`, `npm test` pass, and the library bundle builds.

## Outcome (2026-10-27)

Built as ward-auth 0.6.0, on top of 0.5.0 (brief 36).

- Migration 4, `user_disabled_at`, appended last: a nullable
  `auth_users.disabled_at`. `UserRecord.disabledAt`, `AuthStore.setDisabled`
  and `AuthUser.disabled` are as the brief says.
- `disableUser` and `enableUser` answer the updated `AuthUser`, or `undefined`
  for no such user, as `renameUser` does. The brief didn't say what they
  return. Disabling a disabled user keeps the first stamp and still ends any
  sessions, and enabling an active user writes nothing.
- The refusals: `verifyCredentials` refuses a disabled user only after the
  hash ran, so a right and a wrong password each cost one `verifyPassword` and
  no dummy hash. `resolveSession` refuses a disabled user's session and
  deletes the row, as for a user who is gone. `startSession` throws a new
  `UserDisabledError` (`code: "user_disabled"`); an unknown user id behaves as
  before. `userForSignIn` throws it for a linked, disabled user before the
  create loop, and also when a raced first sign-in's winner is disabled.
- **The Ward callback answers `access_denied`.** That is the code a refused
  sign-in gets now: the README's error table already gives it for "no grant, a
  disabled account, or Back to the app". `sign_in_failed` would have said "try
  again" and logged an error for a deliberate refusal. The mapping is one
  `catch` in `fastify/ward.ts`'s `finishCallback`, which **isn't on the brief's
  OWN list** (the must-NOT-touch covers `plugin.ts` routes, and none was
  added). The end-to-end test went into `fastify/ward.test.ts` with it.
- `UserDisabledError` isn't exported from the bundle (`index.ts` isn't on the
  list); an app matches `error.code`. The browser bundle's `SessionUser`
  doesn't declare the new `disabled` field the session body now carries. The
  CHANGELOG says both.

Acceptance, end to end against the harness's Ward (`ward.test.ts`): after
`disableUser` the open Ward-originated session answers `401` on its next
request, a password login answers the same `401` body as a wrong password,
and "Sign in with Ward" lands on `/myapp/login?ward_error=access_denied` with
no cookie and no `della-2`. After `enableUser` the old password and the Ward
sign-in both work, as the same user id. A database at migration 3 opens with
every user active (`sqlite.test.ts`, both drivers). Typecheck, lint, the 1223
tests (12 new) and the bundle build pass.

satchel getting its "lost grant locks you out" rule back is a satchel brief.
brief-board is down, so nothing was posted there.
