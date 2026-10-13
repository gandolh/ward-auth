# Changelog

Every version an app can vendor, newest first. Upgrading is a manual copy
(`npm run vendor -- <app>/vendor/ward`), so **every breaking change carries an
upgrade note** saying exactly what the app must change.

Schema changes are migrations the library applies itself on
`createSqliteStore`; a note says when one is added, and never to edit one.

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

The login lockout sees the real client behind a container (Ward's brief 28).

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
