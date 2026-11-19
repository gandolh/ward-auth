# Changelog

Every version an app can vendor, newest first. Upgrading is a manual copy
(`npm run vendor -- <app>/vendor/ward`), so **every breaking change carries an
upgrade note** saying exactly what the app must change.

Schema changes are migrations the library applies itself on
`createSqliteStore`; a note says when one is added, and never to edit one.

## 1.1.0 — 2026-11-19

A username that reads the same as another user's is taken.

- Each user carries a key for what the name looks like,
  `usernameSkeleton(username)`, which the server bundle exports. It is
  Ward's key for its own accounts: Unicode's skeleton (UTS #39) of the name
  as typed, the fold, then the skeleton again, through Unicode's
  confusables table, version 17.0.0. `AIice` (a capital I) and `alice` share
  a key, as do `b0b` and `bob`, `MODERN` and `rnodern`, and a Cyrillic
  `аlice` and `alice`.
- A new name or a rename whose key another user holds is taken, with the
  answer a name taken in another case gets:
  - `POST <routePrefix>/register` and `POST <routePrefix>/username` answer
    `409 { error: "username_taken" }`. Each such rename counts against the
    rename budget, as a taken name does.
  - A first Ward sign-in whose name reads the same as a user's takes the
    next suffix (`-2`, `-3`, …): `N0EL` becomes `N0EL-2` beside a `noel`.
  - `Accounts.createUser`, `renameUser`, `seedUsers` and
    `WardIdentities.createLinkedUser` throw `UsernameTakenError`.
    `seedUsers` skips a user whose name exists in any case; a seed name
    that only reads the same as another user's throws.
  - A key no other user holds is not taken, so a rename onto a name that
    reads the same as one's own goes through. A user in a group migration 5
    kept (below) shares the key with the others, so each rename of theirs
    that keeps it, a new case of their own name included, is taken; a name
    that reads differently goes through.
- **Migration 5**, `username_skeleton`: an indexed, nullable
  `auth_users.username_skeleton`, filled for every existing user by the boot
  that applies it. Users that already share a key all stay as they are, and
  that boot logs one `console.warn` per group, naming their ids. Such a
  group takes no new member. To list the groups later:
  `SELECT username_skeleton, group_concat(id, ' ') FROM auth_users GROUP BY username_skeleton HAVING count(*) > 1`.
- `Migration` gains an optional `run(db)` step, run after its `sql` in the
  same transaction; a throw rolls both back.
- `AuthStore` gains `findUsersByUsernameSkeleton(key)`: every user holding
  the key, oldest first. `NewUserRecord` gains `usernameSkeleton`, and
  `setUsername` takes it as its fourth argument, before `now`. `createUser`,
  `createUserWithWardLink` and `setUsername` throw `UsernameTakenError` when
  another user holds the key, checked in the same transaction as the write.
  `UserRecord` is unchanged.
- The server bundle carries the table, about 90 kB of its 334 kB. The React
  bundle differs only in the version in its banner.

Upgrade notes from 1.0.0:

- Re-vendor (`npm run vendor -- <app>/vendor/ward`), the server copy and
  the web copy. Migration 5 runs on the next boot by itself. Nothing to
  change in app code.
- If that boot logs users whose names read the same, decide whether they
  are one person. If not, rename one of them (`Accounts.renameUser`).
- A seed list naming someone whose name reads the same as an existing
  user's throws at `seedUsers`; give that person another name.
- A test of the app's own that inserts `auth_users` rows by hand keeps
  working. Such a row has no key, so the look-alike rule does not see it;
  the folded name stays unique.
- A custom store (not `createSqliteStore`) implements
  `findUsersByUsernameSkeleton`, stores `usernameSkeleton`, takes it in
  `setUsername`, and refuses a key another user holds. A direct call to
  `store.setUsername` passes the key:
  `setUsername(id, name, foldUsername(name), usernameSkeleton(name), now)`.

## 1.0.0 — 2026-11-19

Linking and unlinking Ward ask for the account's password, the plugin acts
on a cookie only when a request carries one copy of it, and the sign-in
budget counts attempts still running. A major version: the browser bundle's
link and unlink calls take an argument they did not take before.

Linking and unlinking Ward:

- `POST <routePrefix>/ward/link` and `POST <routePrefix>/ward/unlink` take
  `{ currentPassword }`, the account's local password, as
  `POST <routePrefix>/password` does: `400 invalid_request` without it,
  `401 invalid_credentials` when it is wrong. Both run under the
  password-change budget that `/password` and `/ward/set-password` share, so
  five wrong passwords from one address in 15 minutes earn
  `429 too_many_attempts`, on all four routes.
- The `409`s come first, before the body is read, and are the ones apps
  know: link answers `already_linked` (a user created from Ward is linked),
  unlink `not_linked` and `no_local_password`. Link also answers
  `no_local_password` for a user with no local password and no link, which
  only an app that creates such a user can have.
- The link callback finishes a link only for a start that `POST /ward/link`
  held after the password, for the same session, once, within ten minutes.
  Any other link flow lands on `settingsPath?ward_error=invalid_callback`.
  The starts are held in the app's memory, so a link still waiting for Ward
  when the app restarts lands there too, and the person starts it again.
- `Accounts` gains `checkPassword(userId, password)`, the password check by
  user id. It changes nothing, and answers `false` for an unknown id, a user
  with no local password, a disabled user or a wrong password, at one scrypt
  cost each.
- The browser bundle: `startWardLink(currentPassword)`,
  `unlinkWard(currentPassword)`, `useWardLink().link(currentPassword)` and
  `useWardUnlink().unlink(currentPassword)`. The argument is required. An
  optional one would compile into a call the server always refuses, and
  `onClick={link.link}` would send the click event as the password; a
  required one shows every call site at the next typecheck.

One copy of a cookie, or none:

- `readCookie(header, name)` answers a value only when the header carries
  exactly one non-empty copy of `name`, and `undefined` when it carries
  several. An empty copy (a cleared cookie) does not count. The plugin reads
  its session cookie and its Ward flow cookie this way.
- A request carrying the session cookie more than once is signed out. The
  guard answers `401 { error: "unauthorized" }` (`POST /ward/logout` too),
  `GET <routePrefix>/session` answers `user: null`, and nothing is cleared.
  `POST <routePrefix>/login` and a Ward sign-in start a new session and end
  no earlier one. While the other copy stays in the browser, its requests
  stay signed out, after a new sign-in too.
- A link or reauthentication callback carrying the session cookie more than
  once lands on `settingsPath?ward_error=unauthorized`. One carrying the flow
  cookie (`<cookieName>_ward`) more than once lands on
  `loginPath?ward_error=invalid_callback`.
- `POST <routePrefix>/logout` ends the session of every copy it carries,
  then clears the cookie.

The sign-in budget:

- Attempts still running count against the five. `/login`, `/password`,
  `/username`, `/ward/set-password`, `/ward/link` and `/ward/unlink` each
  hold one of the address's slots until the attempt ends, so requests sent
  together from one address get five verdicts and then `429`. A refusal
  caused only by attempts still running says `Retry-After: 1`
  (`retryAfterSeconds: 1`).
- `Lockout` gains the required member `reserveAttempt(target)`, answering a
  `LockoutGate`; its `LockoutAttempt` ends with `fail(account?)`,
  `succeed(account?)` or `release()`. Both types are exported.
- An IPv6 client is counted by its /64, and an IPv4-mapped address, in
  either spelling, as the IPv4 address it carries. `lockoutKeyFor` still
  answers the full address, and now answers a hex-spelled IPv4-mapped one
  (`::ffff:7f00:1`) in dotted form (`127.0.0.1`), as it did the dotted
  spelling.
- A trusted peer whose last `X-Forwarded-For` element is not an IP address
  is keyed on the peer, with the throttled warning, which now reads "no
  X-Forwarded-For address arrived".
- Each account's share of a counter is filed under a 24-character digest of
  its folded name, so a long name takes no more memory than a short one.

Upgrade notes from 0.7.2:

- **Re-vendor the server and the web package together**
  (`npm run vendor -- <app>/vendor/ward`, once for each). No migration. The
  new server copy alone refuses every link and unlink from the old web copy
  as `invalid_request`.
- **The settings page needs a password field on Link Ward and on Unlink
  Ward**, passed as `link(currentPassword)` and `unlink(currentPassword)` (or
  `startWardLink` and `unlinkWard`). Show `invalid_credentials` and
  `too_many_attempts` (with `retryAfterSeconds`) beside the button: a
  refused link stays on the page. A user with no local password
  (`!user.hasPassword`) has nothing to type; offer "Set a local password"
  first, as before, and the server answers `no_local_password` whatever is
  sent.
- A test or a client of the app's own that posts to `/ward/link` or
  `/ward/unlink` sends `{ "currentPassword": ... }` as a JSON body.
- An `Accounts` built by hand (not `createAccounts`) must implement
  `checkPassword`; a `Lockout` built by hand must implement
  `reserveAttempt`.
- Nothing else to change for the cookie and budget items. An app that reads
  a cookie of its own with `readCookie` now gets `undefined` for a name sent
  more than once.

## 0.7.2 — 2026-11-12

No change for apps. `SessionValidator` and `SessionVerdict` moved to a module
of their own in the source, so the Fastify plugin and the Ward routes no
longer import each other.

- Both JavaScript bundles differ from 0.7.1's only in the version in their
  banner. In `ward-auth.d.ts` the two types are declared earlier in the file,
  unchanged; the React declarations differ only in the banner.

Upgrade notes from 0.7.1:

- Nothing to change, and no migration. Re-vendoring is optional.

## 0.7.1 — 2026-11-11

No change for apps. The source moved to the estate's house style, and two
reads in the server bundle changed shape without changing what they do.

- The source is formatted with Prettier at width 120, and its tsconfig turns
  on `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and
  `erasableSyntaxOnly`. `WardSignInError`'s `code` is a declared field
  instead of a parameter property; the built class is the same.
- Two reads no longer assert non-null: `migrateSqlite`'s newest known
  migration, and `wardClientOptionsFromEnv`, which reads each variable once.
  The checks, the `TypeError` and its text are the same.
- The React bundle and both declaration files differ from 0.7.0's only in
  the version in their banner.

Upgrade notes from 0.7.0:

- Nothing to change, and no migration. Re-vendoring is optional.

## 0.7.0 — 2026-10-27

A refused "Sign in with Ward" keeps the path it was started with.

- When a sign-in started with `signIn({ returnTo })` fails, the callback lands
  on `loginPath?ward_error=<code>&ward_return_to=<returnTo>`. That covers every
  sign-in failure: Ward's refusals (`access_denied`), a failed or expired code
  exchange (`invalid_callback`, `ward_unavailable`, `ward_misconfigured`),
  `sign_in_failed`, and a user the app disabled. A callback with no readable
  flow cookie has no path to carry and lands as before. Link and
  reauthentication failures on `settingsPath` are unchanged.
- The path is checked with `isLocalPath` when it is written, as `returnTo` was
  at the start. The browser client checks it again when it reads it, and only
  beside a `ward_error`; anything else is dropped. Either way the parameter is
  taken out of the address bar with `ward_error`.
- `WardResult` gains `returnTo?: string`, and `useWardSignIn()` returns
  `returnTo` (`null` when there is none). `clearWardResult()` and `reset()`
  dismiss the error but keep `returnTo`.
- `isLocalPath` moved from `fastify/ward.ts` to `core/paths.ts`, unchanged, so
  both bundles use one rule. It is not exported.

Upgrade notes from 0.6.1:

- Re-vendor, into both the server and the web package. No migration.
- Nothing changes on the login page until it uses `returnTo`. To retry to
  the same place, pass `useWardSignIn().returnTo` to `signIn({ returnTo })`.
  `signIn()` without a `returnTo` still goes to `afterSignInPath`.
- sports-app's gap (a retry after a refusal lands on `/`) closes when
  its login page reads `next` back out of `returnTo`.

## 0.6.1 — 2026-10-27

Three names 0.5.0 and 0.6.0 added are now exported.

- `UsernameFor`, the type of `ward.usernameFor`.
- `isUsernameMaxLength(value)`, the check `wardAuth` runs on
  `ward.usernameMaxLength`: a whole number from 10 to 256.
- `UserDisabledError`, which `startSession` and `userForSignIn` throw for a
  disabled user.

Upgrade notes from 0.6.0:

- Re-vendor. Nothing changes at runtime, and there is no migration.
- A hook typed as `WardSignInOptions["usernameFor"]` can be typed as
  `UsernameFor`. A cap read from the environment can be checked with
  `isUsernameMaxLength` before `wardAuth` throws on it. A `catch` that matches
  `error.code === "user_disabled"` can use `instanceof UserDisabledError`; the
  code is unchanged, so the old check still works.

## 0.6.0 — 2026-10-27

An app can switch a local user off.

- `Accounts.disableUser(userId)` stamps the user disabled and ends every
  session they hold; `Accounts.enableUser(userId)` clears it. Both answer the
  updated `AuthUser`, or `undefined` for no such user. Disabling twice keeps
  the first stamp. Nothing is deleted.
- A disabled user is refused everywhere a user gets in, with the answer an
  unknown one gets. `verifyCredentials` returns `undefined`, still at one
  scrypt cost, so a right and a wrong password cost the same. `resolveSession`
  refuses (and deletes) a session whose user is disabled. `startSession`
  throws `UserDisabledError` (`code: "user_disabled"`). A Ward sign-in for the
  linked subject lands on `loginPath?ward_error=access_denied`, the code a Ward
  refusal gets, and never creates a second user for the subject.
- `AuthUser` gains `disabled: boolean`, so the session body's `user` carries
  `disabled: false` too. The browser bundle's `SessionUser` does not declare
  it.
- **Migration 4**, `user_disabled_at`: a nullable `auth_users.disabled_at`.
  `createSqliteStore` applies it on open, and every existing user stays active.
  `UserRecord` gains `disabledAt`.
- `AuthStore` gains `setDisabled(userId, disabledAt | null, now)`.

Upgrade notes from 0.5.0:

- Re-vendor. The migration runs on the next boot. Nothing changes until the
  app calls `disableUser`.
- **A custom store (not `createSqliteStore`) must implement `setDisabled`**
  and return `disabledAt` on its user records (`null` for active).
- A test that compares an `AuthUser` with `toEqual` needs `disabled: false`.
- There is no route for it. An app calls `disableUser` from its own code; for
  satchel, that is getting back its "lost grant locks you out" rule.

## 0.5.0 — 2026-10-27

An app shapes a new Ward user's username.

- `ward.usernameFor({ username, subject })`, beside `roleFor`: the name a user
  created by a first Ward sign-in starts with, from `preferred_username`. The
  result is the base that gets suffixed when taken, and one that fails the
  library's username policy becomes `ward-user`, as a bad `preferred_username`
  does. A hook that throws is logged and lands on
  `loginPath?ward_error=sign_in_failed`, with no user created. It runs only
  when a user is created.
- `ward.usernameMaxLength` (10 to 256, default 256): every name a first Ward
  sign-in tries fits it, suffixes included. The library cuts the base to make
  room for `-2` or `-<8 hex>`, so a hook that cuts to 16 and
  `usernameMaxLength: 16` give `alice.smith-wi-2`. Out of range throws at
  registration.
- `WardIdentities.userForSignIn` takes the same two, after `roleFor`:
  `(identity, roleFor?, usernameFor?, usernameMaxLength?)`.

Upgrade notes from 0.4.0:

- Re-vendor. Nothing changes until an app passes `usernameFor`. No migration.
- An app that refuses names its own rule can't store (sports-app) can shape
  them with `usernameFor` instead, and pass its cap as `usernameMaxLength`.

## 0.4.0 — 2026-10-24

A signed-in user can rename themselves.

- `Accounts.renameUser(userId, username)` trims and checks the name as
  `createUser` does (`UsernamePolicyError`), refuses one another user holds once
  folded (`UsernameTakenError`; the user's own name in another case is fine),
  and answers the updated `AuthUser`, or `undefined` for no such user. The id
  stays and no session ends: a rename is not a credential change. An admin
  screen that renames someone else calls this itself; the library adds no
  admin route.
- `POST <routePrefix>/username`, guarded, body `{ username }`: `200` with the
  session body under the new name, `400 invalid_username` or
  `409 username_taken`. Each `409` counts against a new `rename` lockout surface,
  so five taken names from one address in 15 minutes earn a `429`. On by
  default; `allowRename: false` removes the route.
- `AuthStore` gains `setUsername(userId, username, usernameFolded, now)`, which
  throws `UsernameTakenError` when another user holds the folded name.
  `LockoutSurface` gains `"rename"`.
- The browser bundle gains `client.renameUser(username)` and the
  `useRenameUser()` hook, shaped like `useChangePassword`. On success the
  session state already carries the new name.

Upgrade notes from 0.3.1:

- Re-vendor (`npm run vendor -- <app>/vendor/ward`). No migration: the
  columns exist.
- **The route is on as soon as you upgrade.** Nothing calls it until the
  settings page does, but an app that keys anything on the username rather
  than the user id, or that names its users itself, should pass
  `allowRename: false` to `wardAuth`.
- To offer it, put `useRenameUser()` on the settings page: a field holding
  `user.username`, `renameUser(next)` on submit, and messages for
  `invalid_username`, `username_taken` and `too_many_attempts`.
- A seed that runs again with the old name creates a second user, because a
  seed matches by name. Change the name the seed is given too.
- A custom store (not `createSqliteStore`) must implement `setUsername`.

## 0.3.1 — 2026-10-13

Review fixes. One is a security fix, so every app should take this.

- **Setting a first local password needs a reauthentication.** Before, any
  Ward-originated session under ten minutes old was enough. But
  `POST /ward/start` is public, and with a live Ward session Ward answers it
  without asking for anything. So anyone at an unattended app session could
  mint a "fresh" session and set a permanent password. Now only
  `POST /ward/reauthenticate` counts. It still sends `prompt=login`, and its
  callback now checks that the ID token's `auth_time` is at most 120 s before
  its `iat`. Only then is the new session stamped as reauthenticated, and
  `set-password` without `currentPassword` needs that stamp within ten
  minutes. A reauthentication whose token fails the check lands on
  `settingsPath?ward_error=invalid_callback`.
- **The Ward callback no longer answers a raw `500`.** Anything that throws
  after the code exchange (the store, the app's `roleFor`) is logged and lands
  on the attempt's page with `ward_error=sign_in_failed`, a new code.
- **A suffixed username never splits a character.** A taken
  `preferred_username` at the length limit was cut through a surrogate pair,
  and the sign-in failed. The cut now falls between code points. Every
  candidate is checked against the policy, with `ward-user-<random>` as the
  last resort.
- **A plain-HTTP issuer must be real loopback.** `http://127.evil.example`
  passed the loopback check. Now only `localhost`, `[::1]` and IPv4 literals in
  `127.0.0.0/8` do.
- Migration 3, `session_reauthenticated_at`, adds a nullable
  `auth_sessions.reauthenticated_at`. `WardAuthStore` gains
  `setSessionReauthenticatedAt` and `findSessionReauthenticatedAt`, and
  `isWardAuthStore` requires them.
- `WardIdentity` gains optional `authTime` and `issuedAt`, from the ID token.

Upgrade notes from 0.3.0:

- Re-vendor (`npm run vendor -- <app>/vendor/ward`). Migration 3 runs by
  itself on the next `createSqliteStore`. Existing sessions keep working.
  None of them counts as reauthenticated.
- **Check the settings page's "Set a local password" flow.** A user with no
  local password now always gets `reauthentication_required` until they
  have used `reauthenticate()`, including right after signing in with Ward.
  If the page shows the password form first and offers `reauthenticate()`
  only on that error, it still works. It is smoother to lead with
  `reauthenticate()` and show the form once `reauthenticated` is true.
- Show `sign_in_failed` on the login and settings pages like
  `invalid_callback`: "that didn't work, try again". An app that treats
  unknown codes generically needs no change.
- A custom store (not `createSqliteStore`) used with the `ward` option must
  implement the two new methods.

## 0.3.0 — 2026-10-13

The login lockout sees the real client behind a container.

- `wardAuth` takes `trustedProxies` (`readonly string[]`): socket peers,
  beyond loopback, whose `X-Forwarded-For` the lockout believes. Addresses or
  CIDR ranges, IPv4 or IPv6. An IPv4-mapped IPv6 peer matches an IPv4 range.
  When the option is absent, the plugin reads `AUTH_TRUSTED_PROXIES`
  (comma-separated) from the environment. A malformed entry, host bits set
  past the prefix, or a `/0` throws at registration.
- `lockoutKeyFor` takes `trustedProxies` in its options, parsed once by the
  new `parseTrustedProxies`. It still reads only the **last** forwarded
  element. A trusted or loopback peer with no forwarded address still fails
  closed into one shared bucket and warns.
- A new throttled warning, "X-Forwarded-For ignored for the login lockout",
  fires when an untrusted peer sends the header. That is what a proxy missing
  from the list looks like.
- Exports `parseTrustedProxies`, `TrustedProxies` and `TrustedProxyRange`.

Upgrade notes from 0.2.0:

- **An app that runs in a container must set `AUTH_TRUSTED_PROXIES`.** Under
  0.2.0, the peer such an app sees is Docker's proxy or a sibling container,
  never loopback. So every request keyed on that one address, and five bad
  passwords from anyone locked everyone out of login, registration and
  password change for 15 minutes. Use Docker's default `172.16.0.0/12` unless
  the stack pins a subnet. Vendoring 0.3.0 and setting the variable is the
  whole fix. No code change is needed.
- An app on loopback (pm2 on the host) needs nothing. Unset means loopback
  only, exactly as before.
- A deploy that sets the variable to something malformed now fails at boot
  rather than starting with the wrong trust.

## 0.2.0 — 2026-10-13

"Sign in with Ward". The adoption guide is [README.md](./README.md).

- Ward client (`createWardClient`, `wardClientOptionsFromEnv`): an OpenID
  Connect code flow with PKCE against Ward through a bundled `openid-client`
  6.8.8, `private_key_jwt` client authentication with the app's Ed25519 key,
  and ID tokens pinned to `EdDSA` with their signatures verified. Discovery
  runs once, lazily, so an app boots while Ward is down.
- The 30-second check: `POST /session-status` for Ward-originated sessions,
  cached 30 s per Ward session with concurrent checks collapsed into one, and
  failing closed (`ward_unavailable`, or `ward_misconfigured` on a `401`).
  Local sessions never call Ward.
- Linking (`createWardIdentities`): a first Ward sign-in creates a linked
  user, link and unlink from settings, `createLinkedUser` for migrating rows
  keyed by a Ward subject, and `notifyUser` for mail through Ward. Nothing is
  ever matched by username.
- Fastify: the `ward` option of `wardAuth` adds `/ward/start`,
  `/ward/callback`, `/ward/link`, `/ward/reauthenticate`, `/ward/unlink`,
  `/ward/set-password` and `/ward/logout` under `routePrefix`.
- React: `useWardSignIn`, `useWardLink`, `useWardUnlink`,
  `useSetLocalPassword`, `useWardSignOut` and `useWardResult`.
- Store: migration 2 adds `auth_ward_links` and `auth_sessions.ward_id_token`.
  `createSqliteStore` applies it. `WardAuthStore` extends `AuthStore`.

Upgrade notes from 0.1.0:

- Vendor the new build. Migration 2 applies itself on the next
  `createSqliteStore`.
- `GET /session`, `POST /login` and `POST /register` answer a new field,
  `ward: { enabled, linked }`. The React `SessionState` has `ward` on
  `signed_in` and `signed_out`. Code that builds or deep-compares those
  objects must add it.
- `SqliteAuthStore` is now `SyncStore<WardAuthStore>`, a superset of before.
- A custom `AuthStore` keeps working for local accounts. The `ward` option
  needs a store that implements `WardAuthStore`.
- A session that began with Ward is refused (`ward_unavailable`) by a plugin
  without the `ward` option. 0.1.0 never created one.

## 0.1.0 — 2026-10-13

First version: local accounts.

- Core: scrypt passwords (ported from Ward, hashes portable both ways), the
  address-keyed lockout with per-account forgiveness, opaque server-side
  sessions (32 random bytes, stored as SHA-256; 14-day sliding idle expiry,
  30-day absolute, renewed at most hourly), user creation with an optional
  app-supplied id, password change that ends the user's other sessions, and
  `seedUsers`.
- Store: `createSqliteStore(handle)` over better-sqlite3 or `node:sqlite`.
  Migration 1 creates `auth_users`, `auth_sessions` and `auth_migrations`.
- Fastify: the `wardAuth` plugin (login, logout, session, password, optional
  register) and the app-wide `onRequest` guard with an allowlist and a
  `validateSession` hook; `requireRole`.
- React: `configureAuth`, `useSession`, `useLogin`, `useLogout`,
  `useChangePassword`, `useRegister`.

Upgrade notes: none — nothing to upgrade from.
