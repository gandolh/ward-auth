# Library: shape a new Ward user's username, and rename users

**Promoted 2026-10-23**, one brief per bullet:
[36](../briefs/todo/36-library-username-for-a-new-ward-user.md) (`usernameFor`),
[37](../briefs/todo/37-library-rename-a-user.md) (rename) and
[38](../briefs/todo/38-library-disable-a-user.md) (disable). Delete this todo when all three land.

Captured 2026-10-13 from the Wave C adoptions (briefs 22, 24, 25).

- **No hook shapes a first Ward sign-in's username.** The library takes
  `preferred_username` as given, up to 256 characters and mixed case.
  sports-app refuses names its sync can't store with an app validator.
  A `usernameFor(claims)` option would let an app normalise instead of
  refusing.
- **There is no rename.** Migrated users in atrium, prm and sports-app carry
  placeholder names (`user-<8 chars of subject>`, or the raw subject in
  sports-app) until renamed, and nothing can rename them. An
  `accounts.renameUser(id, username)` plus a settings hook would close it.
- **No way to switch off a local user.** satchel lost its "lost grant locks
  you out" rule. A local user keeps working after their Ward grant is
  removed. An `accounts.disableUser` would give apps that control back.
