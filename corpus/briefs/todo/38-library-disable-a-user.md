# Task 38: Library: switch off a local user

## Context

Promoted 2026-10-23 from the todo
[library-username-shaping-and-rename](../../todos/library-username-shaping-and-rename.md),
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
