# Task 37: Library: rename a user

## Context

Promoted 2026-10-23 from the todo
[library-username-shaping-and-rename](../../todos/library-username-shaping-and-rename.md),
second bullet. Briefs 36 and 38 take the other two.

There is no rename. Migrated users in atrium, prm and sports-app carry placeholder
names (`user-<8 chars of subject>`, or the raw subject in sports-app) until renamed,
and nothing can rename them. User ids are opaque and stable
([decisions.md](../../wiki/decisions.md)), so an app's own rows key on the id and
survive a rename; only the display name and the login name change.

The store keeps `username` and `username_folded` (unique) on `auth_users`
([`store/migrations.ts`](../../../shared-library/src/store/migrations.ts), version
1). `AuthStore` in [`store/types.ts`](../../../shared-library/src/store/types.ts)
has `setRole` and `setPasswordHash` but nothing that writes the name.
`Accounts` in [`core/accounts.ts:82`](../../../shared-library/src/core/accounts.ts)
is where `renameUser` goes. The plugin's self-service routes
(`/login`, `/logout`, `/session`, `/password`, `/register` in
[`fastify/plugin.ts`](../../../shared-library/src/fastify/plugin.ts)) and their React
hooks (`useChangePassword` and others in
[`react/hooks.ts`](../../../shared-library/src/react/hooks.ts)) are the pattern for
the settings half.

Run it after brief 36: they share `CHANGELOG.md`, the version and some files, so build them one at a time.

## Files you OWN

- `shared-library/src/store/types.ts`, `store/sqlite.ts`, `store/sqlite.test.ts`
- `shared-library/src/core/accounts.ts`, `core/accounts.test.ts`
- `shared-library/src/fastify/plugin.ts` and its test
- `shared-library/src/react/hooks.ts`, `react/client.ts` and their tests
- `shared-library/README.md`, `CHANGELOG.md`, `package.json` (version)

## Files you must NOT touch

- `store/migrations.ts`: no schema change is needed; the columns exist. Never edit
  an applied migration.
- Any app's `vendor/ward/` or its settings screen. Each app adopts this in its own
  brief.

## What to do

1. `AuthStore.setUsername(userId, username, usernameFolded, now)`: throws
   `UsernameTakenError` when the folded name is held by another user. Renaming to
   your own name in a different case is allowed.
2. `Accounts.renameUser(userId, username)`: normalises through `normaliseUsername`
   (so `UsernamePolicyError` for a bad name), folds, writes, returns the updated
   `AuthUser`. Sessions are not ended: a rename is not a credential change.
3. `POST /username` in the plugin, for the signed-in user only: same-origin check,
   session required, body `{ username }`, `400` for the policy error, `409
   username_taken`, `200` with the session's new view. An option to switch the
   route off (default on) for apps that don't want self-service renames.
4. A `useRenameUser()` hook that matches `useChangePassword`'s shape and refreshes
   the session on success.
5. An app that wants to rename for someone (an admin screen) calls
   `accounts.renameUser` itself; the library adds no admin route.
6. Minor version bump and a CHANGELOG entry saying how an app turns the route on in
   its settings screen.

## Acceptance

- A user named `user-1a2b3c4d` renames to `Alice`; logging in as `alice` works, the
  old name no longer does, the user id is unchanged and no session ended.
- Renaming to a name another user holds (in any case) answers `409 username_taken`
  and changes nothing.
- A cross-site `POST /username` is refused like the other routes.
- `npm run typecheck`, `npm run lint`, `npm test` pass, and the library bundle builds.
