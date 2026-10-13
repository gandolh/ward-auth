# ward-auth (shared library)

Local accounts, sessions and lockout for the estate's apps, plus "Sign in with
Ward". It ships as a built bundle that each app copies into `vendor/ward/`.
The design is in `corpus/wiki/decisions-oidc.md`, and the build calls are in
`corpus/wiki/decisions-oidc-build.md`.

**This page is the adoption guide.** An app that moves off the old Ward
integration (the `client/` package, `/introspect`, the app key and the dev
`/ward` proxy) follows it from top to bottom. It replaces
`corpus/wiki/integrating.md` for new work.

- [What an app gets](#what-an-app-gets)
- [1. Vendor the build](#1-vendor-the-build)
- [2. Hand over the SQLite handle](#2-hand-over-the-sqlite-handle)
- [3. Configure Ward from the environment](#3-configure-ward-from-the-environment)
- [4. Register the plugin](#4-register-the-plugin)
- [5. Cookie scoping and the callback path](#5-cookie-scoping-and-the-callback-path)
- [6. Seed local users](#6-seed-local-users)
- [7. Migrate rows keyed by a Ward subject](#7-migrate-rows-keyed-by-a-ward-subject)
- [8. Remove the old Ward module and the dev `/ward` proxy](#8-remove-the-old-ward-module-and-the-dev-ward-proxy)
- [9. Build the login and settings pages on the hooks](#9-build-the-login-and-settings-pages-on-the-hooks)
- [Error codes](#error-codes)
- [Mail](#mail)
- [Gotchas](#gotchas)
- [Commands and upgrading](#commands-and-upgrading)

## What an app gets

- **Its own accounts.** A users table in its own database (`auth_users`),
  scrypt passwords, lockout, and opaque server-side sessions in a cookie. Local
  sign-in never calls Ward, so the app keeps working while Ward is down.
- **"Sign in with Ward"** as a second way in: an OpenID Connect code flow with
  PKCE against Ward, finished by the app's server. A first Ward sign-in creates
  a local user linked to the Ward account. A person who already has a local
  account links Ward from their own settings. Nothing is ever matched by
  username.
- **Revoke-everywhere for Ward sessions.** A session that began with Ward is
  checked against Ward at most every 30 seconds. A sign-out at Ward, a console
  revoke or a removed grant ends it on the first request after that. If Ward
  cannot answer, the session is refused (`ward_unavailable`) and the person
  signs in with their local password. Local sessions are never checked.
- **Unstyled React hooks.** The app keeps its own login, register and settings
  pages in its own design.

Everything below uses `myapp` and `https://example.com`. Put your app's slug,
paths and origin in their place.

## 1. Vendor the build

From this repository's root:

```sh
npm run vendor -- <path to the app>/vendor/ward
```

The target is resolved from the directory you ran `npm` in. A copy holds
exactly six files and needs no install of its own:

| File                   | What it is                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ward-auth.js`         | Server bundle: accounts, sessions, lockout, the SQLite store, "Sign in with Ward", the Fastify plugin. `openid-client` is bundled in. |
| `ward-auth.d.ts`       | Its types                                                                                                                             |
| `ward-auth-react.js`   | Browser bundle: the React hooks. Imports only `react`.                                                                                |
| `ward-auth-react.d.ts` | Its types                                                                                                                             |
| `README.md`            | Version, source, where the upgrade notes are                                                                                          |
| `LICENSE`              | MIT                                                                                                                                   |

Import the bundles by relative path, from TypeScript or a plain `.mjs` server:

```js
import { createAccounts, createSqliteStore, wardAuth } from "../vendor/ward/ward-auth.js";
```

The server bundle imports nothing at runtime except `node:` built-ins.
Fastify (5) and React (18 or 19) come from the app's own dependencies. Do not
edit a vendored file. To upgrade, vendor a newer build over the copy and follow
the [CHANGELOG](./CHANGELOG.md). `vendor` refuses a directory that holds
anything other than the six files.

Vendor into the package that imports the bundle, so that `react` and
`fastify` resolve from that package. An app whose web client and server are
separate packages vendors twice, once into each, and both copies must be the
same version.

## 2. Hand over the SQLite handle

The store runs on the database handle the app already has. It works with
better-sqlite3 or `node:sqlite`. An app on Knex or Drizzle hands over the
better-sqlite3 handle underneath.

```js
import Database from "better-sqlite3"; // or: import { DatabaseSync } from "node:sqlite";
import { createAccounts, createSqliteStore } from "../vendor/ward/ward-auth.js";

const db = new Database(process.env.DB_PATH);
const accounts = createAccounts({ store: createSqliteStore(db) });
```

`createSqliteStore` applies the library's own migrations before it returns.
Its tables are `auth_users`, `auth_sessions`, `auth_ward_links` and
`auth_migrations`, and they never touch the app's tables. It can run before or
after the app's own migrations. An app's table can reference
`auth_users (id)`. The store also works inside an app's own transaction,
because it uses savepoints.

## 3. Configure Ward from the environment

```js
import { createWardClient, wardClientOptionsFromEnv } from "../vendor/ward/ward-auth.js";

const wardOptions = wardClientOptionsFromEnv(); // reads process.env
const wardClient = wardOptions === undefined ? undefined : await createWardClient(wardOptions);
```

| Variable                             | Value                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WARD_OIDC_ISSUER`                   | Ward's issuer, external, ending in `/oidc`, e.g. `https://example.com/ward-api/oidc`. Plain `http:` only on loopback.                                 |
| `WARD_OIDC_CLIENT_ID`                | The app's slug at Ward                                                                                                                                |
| `WARD_OIDC_CLIENT_KEY`               | The app's Ed25519 private key, base64url of a JSON JWK. **A secret.**                                                                                 |
| `WARD_OIDC_REDIRECT_URI`             | The callback as the browser reaches it: `https://example.com/myapp-api/auth/ward/callback` (see [section 5](#5-cookie-scoping-and-the-callback-path)) |
| `WARD_OIDC_POST_LOGOUT_REDIRECT_URI` | Optional. Where Ward returns after "sign out of Ward too", e.g. `https://example.com/myapp/`. Must be registered at Ward.                             |

- **Locally**, Ward's `infrastructure/local/seed.mjs` writes all five into
  each app's gitignored `.env` and registers the client at the local Ward.
- **In production**, the deploy provides them. Ward's console registers the
  client (redirect URIs, post-logout URIs, public key). `npm run
oidc-client-key` in Ward prints a fresh pair: the private env line for the
  app and the public JWK for the console.
- With **no `WARD_OIDC_ISSUER`**, `wardClientOptionsFromEnv()` returns
  `undefined` and the app runs with local accounts only. With the issuer set
  but another variable missing, it throws and names what is missing.
- `createWardClient` checks the values and imports the key at boot, so a bad
  key fails at startup. **It does not contact Ward at boot.** Discovery happens
  on first use and is then cached, so the app starts while Ward is down.
- Nothing assumes Ward shares the app's origin. Every Ward URL comes from the
  issuer.

The old variables (`WARD_PUBLIC_ORIGIN`, `WARD_API_BASE_PATH`, `WARD_APP_KEY`)
are not read. Remove them when the old module goes ([section 8](#8-remove-the-old-ward-module-and-the-dev-ward-proxy)).

## 4. Register the plugin

```js
import Fastify from "fastify";
import { requireRole, wardAuth } from "../vendor/ward/ward-auth.js";

const app = Fastify();

await app.register(wardAuth, {
  accounts,
  cookieName: "myapp_session", // unique per app: the estate shares one origin
  cookiePath: "/myapp-api", // the API prefix AS THE BROWSER SEES IT
  publicOrigin: process.env.PUBLIC_ORIGIN, // "https://example.com", no path
  routePrefix: "/auth", // Fastify-side; the default
  publicRoutes: ["GET /health"], // the allowlist; see below
  // trustedProxies: ["172.16.0.0/12"], // omit to read AUTH_TRUSTED_PROXIES; see below
  // registration: { role: "member" },  // only an app with a Register page
  ...(wardClient && {
    ward: {
      client: wardClient,
      loginPath: "/myapp/login", // browser paths on the app's origin
      settingsPath: "/myapp/settings",
      afterSignInPath: "/myapp/",
      // roleFor: (wardRole) => wardRole, // a new Ward user's first role; identity by default
    },
  }),
});

// Every app route AFTER the plugin. Each one has request.auth.
app.get("/items", async (request) => listItems(request.auth.user.id));
app.delete("/items/:id", { preHandler: requireRole("admin") }, deleteItem);
```

- **Register it first.** The guard is an `onRequest` hook on the instance you
  register it on (the plugin escapes encapsulation). Fastify copies hooks into
  a child context when the child is created, so a plugin registered _before_
  `wardAuth` is not guarded.
- **Every route is guarded** unless allowlisted. `publicRoutes` entries are
  `"METHOD /pattern"` or `"/pattern"` (any method), matched against the
  **route pattern** Fastify resolved, not the raw URL. `GET` entries also cover
  `HEAD`. For what a list cannot say, such as a static-file wildcard, pass
  `isPublic: (request) => boolean`. The plugin's own public routes and
  `OPTIONS` preflights are added for you.
- A guarded request without a live session gets
  `401 { "error": "unauthorized", "reason"?: <code> }`.
- `request.auth` is `{ user: { id, username, role, hasPassword }, session: {
origin: "local" | "ward", ... } }`, or `null` on an allowlisted route.
- `requireRole(...roles)` is a `preHandler` that answers `403 { error:
"forbidden" }`. The role lives in the app's own row. Ward's grant only
  decides whether a Ward account may get in, and gives a **new** user their
  first role.
- `validateSession` (one function or an array) adds the app's own session
  checks. They run after the library's Ward check.
- Lockout keys on the client address. It reads the **last** `X-Forwarded-For`
  entry, and only when the socket peer is loopback or a trusted proxy.
  Otherwise it keys on the peer and ignores the header. No Fastify `trustProxy`
  setting is needed, and none should be set.
- **In a container, set the trusted proxies.** Host Caddy reaches a container
  through Docker's proxy, so the peer is a Docker bridge address, never
  loopback. Without a trusted range every request keys on that one address,
  and five bad passwords from anyone lock everyone out for 15 minutes. Set
  `AUTH_TRUSTED_PROXIES` in the app's environment to the network the proxy
  reaches the app from: comma-separated addresses or CIDR ranges, IPv4 or IPv6.
  In production that is Docker's default `172.16.0.0/12` unless the stack pins
  a subnet (`docker network inspect <network>` shows it). The plugin reads the
  variable only when the `trustedProxies` option is absent. A malformed entry
  or a `/0` throws at registration. Unset, only loopback is trusted, as before
  0.3.0. An app on loopback under pm2 needs neither.
- Use `routePrefix`, not `register(..., { prefix })`. A `prefix` is ignored,
  because the plugin escapes encapsulation.

### The routes, as the browser sees them

The plugin's routes live under `routePrefix`. The browser reaches them under
the app's API prefix, e.g. `/myapp-api/auth/...`, which is also the `basePath`
the hooks are configured with.

| Route                            | Guard          | Body → answer                                                       |
| -------------------------------- | -------------- | ------------------------------------------------------------------- |
| `POST /auth/login`               | public         | `{ username, password }` → `200 { user, session, ward }`            |
| `POST /auth/logout`              | public         | → `204`                                                             |
| `GET /auth/session`              | public         | → `{ user, session, ward, reason? }` (`user: null` when signed out) |
| `POST /auth/password`            | session        | `{ currentPassword, newPassword }` → `204`                          |
| `POST /auth/register`            | public, opt-in | `{ username, password }` → `201 { user, session, ward }`            |
| `POST /auth/ward/start`          | public         | `{ returnTo? }` → `{ url }` to send the browser to                  |
| `GET /auth/ward/callback`        | public         | the redirect URI; a `303` to one of the app's pages                 |
| `POST /auth/ward/link`           | session        | → `{ url }`                                                         |
| `POST /auth/ward/reauthenticate` | session        | → `{ url }` (Ward asks for the password again)                      |
| `POST /auth/ward/unlink`         | session        | → `{ signedOut }`                                                   |
| `POST /auth/ward/set-password`   | session        | `{ newPassword, currentPassword? }` → `204`                         |
| `POST /auth/ward/logout`         | session        | → `{ url }`: Ward's end-session URL, or `null`                      |

`ward` in a session answer is `{ enabled, linked }`. `enabled` says whether the
server has Ward configured, so the login page knows whether to show the
button. `linked` says whether the signed-in user has a Ward account linked.

Every `POST` refuses a browser request whose `Origin` or `Sec-Fetch-Site` says
it came from another origin (`403 cross_site`). The hooks send exactly what
passes. A server-side caller that sends neither header is allowed.

## 5. Cookie scoping and the callback path

**The session cookie** is `<cookieName>`, `HttpOnly`, `SameSite=Lax`, `Secure`
unless `publicOrigin` is plain HTTP on loopback, with `Path=<cookiePath>`.

- `cookieName` must be unique in the estate. Every app shares one origin, so
  two apps with one name would overwrite each other's cookie.
- `cookiePath` is the API prefix **as the browser sees it**, even when the
  reverse proxy strips it before Fastify sees the request. Every request that
  needs the session must live under it, including WebSocket upgrades and
  `<img>` sources.
- `SameSite=Lax` is also the CSRF defence, and it lets the cookie ride the
  top-level navigation back from Ward.

**The callback lives under the API prefix.** `WARD_OIDC_REDIRECT_URI` must be
the plugin's `<routePrefix>/ward/callback` as the browser reaches it, e.g.
`https://example.com/myapp-api/auth/ward/callback`. There are two reasons:

1. The session cookie is scoped to the API prefix, and a link callback must see
   the session that started the link.
2. The dev server and Caddy already route the API prefix to the app's server,
   so the callback needs **no new proxy rule** in either.

The plugin checks this at boot: the redirect URI's path must end in
`<routePrefix>/ward/callback` and sit under `cookiePath`. The seed writes it
as `<API prefix as the browser sees it>/auth/ward/callback` for every app's
dev server. So `cookiePath` is that prefix, and `routePrefix` is whatever
Fastify sees for `/auth` under it once the proxy has stripped what it strips.
For a proxy that strips the whole prefix (`/myapp-api/auth/...` reaches
Fastify as `/auth/...`), that is the default `/auth`. For one that strips only
the base (`/myapp/api/auth/...` reaches Fastify as `/api/auth/...`), it is
`/api/auth`. When the API prefix differs between development and production,
set `cookiePath` and `WARD_OIDC_REDIRECT_URI` together per environment.

**The flow cookie** is `<cookieName>_ward`. It holds the `state`, `nonce` and
PKCE verifier for one round trip, and it is scoped to the callback path for
ten minutes. The callback clears it. Starting a second flow in the same browser
replaces the first, and the first one's callback then fails as
`invalid_callback`.

## 6. Seed local users

Apps without a Register page create their users with a seed script.
`seedUsers` creates the users that do not exist yet and never resets a
password or a role, so the script can run on every deploy.

```js
import { createAccounts, createSqliteStore, seedUsers } from "../vendor/ward/ward-auth.js";

const accounts = createAccounts({ store: createSqliteStore(db) });
const result = await seedUsers(accounts, [
  {
    username: process.env.SEED_ADMIN_USERNAME,
    password: process.env.SEED_ADMIN_PASSWORD,
    role: "admin",
  },
]);
console.log(`created: ${result.created.join(", ") || "none"}`);
```

Passwords come from the environment or a prompt, **never from a file in the
repository**. A person who only ever signs in with Ward needs no seeding: their
first Ward sign-in creates their user, if Ward holds a grant for them.

## 7. Migrate rows keyed by a Ward subject

An app that used Ward as its only identity keyed its own rows (owners,
authors, settings) by the Ward **subject**. To keep every row pointing at the
right person, create one local user per known subject, **reuse the subject
as the local id**, and link it to that subject. The person's next "Sign in
with Ward" then finds the linked user, whose `id` is what the rows already
hold. No row is rewritten.

```js
import { createWardIdentities } from "../vendor/ward/ward-auth.js";

const identities = createWardIdentities({ accounts });

// Every subject the app's own rows know, with the username and role it last saw.
for (const { subject, username, role } of knownWardUsers(db)) {
  if (await identities.findUserBySubject(subject)) continue; // idempotent
  await identities.createLinkedUser({ subject, id: subject, username, role });
}
```

- Run it once, before the first deploy of the new version, or on every boot,
  since it skips what already exists. It is one transaction per user: a user
  and its link are created together or not at all.
- A migrated user has **no local password**. They sign in with Ward. In
  settings they can set a local password, which [section 9](#9-build-the-login-and-settings-pages-on-the-hooks)
  covers, so they can still get in while Ward is down.
- Two subjects whose usernames fold to the same name cannot both be created.
  `createLinkedUser` throws `UsernameTakenError`, so pick a suffix yourself.
  It also throws `WardSubjectTakenError` and `UserIdTakenError`.
- A new app table can reference `auth_users (id)`.

## 8. Remove the old Ward module and the dev `/ward` proxy

| Old                                                                                                                     | New                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `client/` (the `ward-client` package) or a hand-written Ward module: JWT verification, `/introspect`, the refresh dance | `wardAuth` and the vendored bundle                                                |
| `WARD_PUBLIC_ORIGIN`, `WARD_API_BASE_PATH`, `WARD_APP_KEY`                                                              | the `WARD_OIDC_*` variables ([section 3](#3-configure-ward-from-the-environment)) |
| The app's own guard over Ward's access token                                                                            | the plugin's guard and `request.auth`                                             |
| Redirecting to Ward's login page with `?next=`                                                                          | the "Sign in with Ward" button (`useWardSignIn`)                                  |
| `notify` with the app key                                                                                               | `identities.notifyUser` ([Mail](#mail))                                           |
| The dev server's `^/ward(-api)?(/                                                                                       | $)`proxy and its`Origin` rewrite                                                  | **delete it**: the browser now goes to Ward's own origin, and the app's server talks to Ward through `WARD_OIDC_ISSUER` |

Delete the old module, its tests, and its env lines, both locally and in the
deploy. Then grep for `x-ward-app-key`, `introspect`, `ward_refresh` and
`/ward-api` to confirm nothing is left. Keep the dev server's proxy for the
app's **own** API prefix: the callback rides it.

## 9. Build the login and settings pages on the hooks

```js
import { configureAuth } from "./vendor/ward/ward-auth-react.js";

// Once, before the first render: the plugin's routes as the browser sees them.
configureAuth({ basePath: "/myapp-api/auth" });
```

Every hook reads one shared session state, with no provider. Each hook returns
state and handlers, and renders nothing. The app writes every word the person
sees, using the [error codes](#error-codes).

### Session

```js
const session = useSession();
// session.status: "loading" | "signed_in" | "signed_out" | "error"
// signed_in:  session.user { id, username, role, hasPassword }, session.session { origin, expiresAt }, session.ward { enabled, linked }
// signed_out: session.reason? ("ward_unavailable", "ward_session_ended", ...), session.ward { enabled }
// error:      session.error { code }
```

When `status` is `signed_out` with `reason: "ward_unavailable"`, show "Ward
is unreachable, sign in with your password" on the login page.

### Login page

```jsx
function LoginPage() {
  const session = useSession();
  const { login, pending, error } = useLogin();
  const ward = useWardSignIn();
  // Form: login(username, password) → true when signed in.
  // Errors: invalid_credentials, too_many_attempts (error.retryAfterSeconds), network.
  // Button, only when session.ward?.enabled: onClick={() => ward.signIn({ returnTo: "/myapp/items/7" })}
  // ward.error: from the button (ward_unavailable) or from the redirect back
  // (access_denied, invalid_callback, ward_unavailable, ward_misconfigured).
  // ward.reset() dismisses it.
}
```

`signIn()` navigates away to Ward. Ward's login page is Ward's own page on
Ward's own origin. On success the browser lands on `returnTo` (a path on the
app's origin) or on `afterSignInPath`, already signed in. On failure it lands
on `loginPath?ward_error=<code>`. The client reads that code once at startup,
removes it from the address bar, and `useWardSignIn().error` starts as it.
`access_denied` means no grant, a disabled Ward account, or the person
pressed "Back to the app" at Ward. A good message is "Ward did not let you
in here; ask the operator for access".

### Settings page

```jsx
function Settings() {
  const session = useSession(); // session.user.hasPassword, session.ward.linked
  const link = useWardLink(); // link(); link.linked after the round trip; link.error
  const unlink = useWardUnlink(); // unlink(); error no_local_password | not_linked
  const local = useSetLocalPassword(); // setPassword(next, current?); reauthenticate()
  const change = useChangePassword(); // for users who have a password
  const out = useWardSignOut(); // signOut(): here and at Ward
}
```

- **Link Ward**: show it when `ward.enabled && !ward.linked`. `link()` goes to
  Ward and comes back to `settingsPath?ward=linked`, or with
  `already_linked`, `ward_account_in_use`, `access_denied`, `invalid_callback`
  or `unauthorized`.
- **Set a local password**: for `!user.hasPassword`. `setPassword(next)` works
  within ten minutes of a Ward sign-in. After that it fails with
  `reauthentication_required`. Call `reauthenticate()`, which goes through
  Ward (Ward asks for its password) and back to `settingsPath?ward=reauthenticated`,
  so `local.reauthenticated` is true, and try again. For a user who has a
  password, `setPassword(next, current)` is a password change.
- **Unlink Ward**: refused with `no_local_password` until the user has one.
  If the current session began with Ward, it ends too (the answer says
  `signedOut`). Every other Ward-originated session of that user ends as well.
- **Sign out of Ward too**: `signOut()` ends the session here and sends the
  browser to Ward, which ends the Ward session this one began with and comes
  back to `WARD_OIDC_POST_LOGOUT_REDIRECT_URI`. For a local session it is a
  plain sign-out. The plain `useLogout()` signs out of the app only.

## Error codes

Every error body is `{ "error": <code> }`. The hooks expose the code as
`error.code`, and the app writes the message. Treat an unknown code like
`unknown`.

| Code                                                          | Where                                          | Meaning                                                            |
| ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `invalid_credentials`                                         | login, password change                         | wrong username or password (one answer for both)                   |
| `too_many_attempts`                                           | login, register, password routes               | lockout; `retryAfterSeconds` says how long                         |
| `invalid_request`                                             | any `POST`                                     | a malformed body                                                   |
| `invalid_username`, `password_too_short`, `password_too_long` | register, new passwords                        | the policy                                                         |
| `username_taken`                                              | register                                       |                                                                    |
| `unauthorized`                                                | guarded routes                                 | no live session; may carry a `reason`                              |
| `forbidden`                                                   | `requireRole`                                  |                                                                    |
| `cross_site`                                                  | any `POST`                                     | a browser said the request came from another origin                |
| `access_denied`                                               | Ward round trip                                | Ward said no: no grant, a disabled account, or "Back to the app"   |
| `ward_unavailable`                                            | Ward round trip, Ward starts, session `reason` | Ward could not be reached; sign in with the local password         |
| `ward_misconfigured`                                          | same places                                    | Ward refused this app's client credential: an operator problem     |
| `ward_session_ended`                                          | session `reason`                               | the Ward session this one began with was signed out or revoked     |
| `invalid_callback`                                            | Ward round trip                                | the round trip expired, was replaced, or did not verify; try again |
| `already_linked`                                              | link                                           | this user already has a Ward account linked                        |
| `ward_account_in_use`                                         | link                                           | that Ward account is linked to another user here                   |
| `ward_account_mismatch`                                       | reauthenticate                                 | a different Ward account came back                                 |
| `not_linked`                                                  | unlink, reauthenticate                         | nothing is linked                                                  |
| `no_local_password`                                           | unlink                                         | set a local password first                                         |
| `reauthentication_required`                                   | set-password                                   | the Ward sign-in is older than ten minutes                         |
| `session_check_failed`                                        | session `reason`                               | an app validator threw (fails closed)                              |
| `network`, `unknown`                                          | client-side                                    | no answer, or an answer without a code                             |

Ward may also send other OAuth error codes back. They pass through as they
are, if they look like codes.

## Mail

Only Ward holds verified addresses, so only linked users can be mailed.

```js
const result = await identities.notifyUser(wardClient, user.id, {
  mailSubject: "Your export is ready", // one line, ≤ 200 characters
  text: "…", // plain text, ≤ 20,000 characters
});
// { sent: true } | { sent: false } (Ward refused, reason not given)
// | { sent: false, reason: "not_linked" } (no call made)
```

It throws `WardUnavailableError` on a transport failure or when Ward's mail is
down (`503`), and `WardConfigurationError` (a subclass) on a `401`. A
`WardClient.sendNotification({ subject, mailSubject, text })` takes a Ward
subject directly.

## Gotchas

- **Register `wardAuth` before every other route and plugin.** If you don't,
  those routes are unguarded.
- **`cookiePath` is the browser's path**, not Fastify's. Behind a stripping
  proxy they differ. If you get it wrong, the browser never sends the cookie.
- **The redirect URI must match Ward's registration exactly**, scheme, host,
  port and path included, or Ward shows its own error page and never returns.
- **An app without Ward configured refuses Ward-originated sessions** with
  `ward_unavailable`, since nothing can check them. Removing `WARD_OIDC_ISSUER`
  signs those people out. It does not leave them unchecked.
- **Ward down never blocks local sign-in.** It only refuses Ward-originated
  sessions, and only until Ward answers again. Their rows are kept.
- **The 30-second cache is per process.** Several server processes each ask
  Ward at most once per 30 seconds per session.
- **Never match users by username or email**, including in a migration. Use
  `createLinkedUser` with the subject, as in section 7.
- **The role is the app's.** A user's role changes only in the app. Ward's
  `ward_role` sets the first role, and `/session-status`'s role is ignored.
- **A containerised app without `AUTH_TRUSTED_PROXIES` has one lockout bucket
  for everybody** (section 4). The log says so: a throttled warning, "X-Forwarded-For
  ignored for the login lockout", names the peer.
- **Guarded files beside the API prefix need a wider `cookiePath`.** If the
  app serves guarded images or downloads outside the API prefix (newspapper's
  `/newspapper/output/*`), scope the cookie to the app base that covers both.
  The callback must still sit under `cookiePath`.
- **Ship `vendor/` in the production image.** A Dockerfile that copies only the
  build output (`dist/`) leaves the bundle behind, and the server crashes at
  import. Copy the package's `vendor/` directory next to `dist/`.
- **better-sqlite3's types may need a cast.** Older `@types/better-sqlite3`
  versions don't satisfy `SqliteHandle`, although runtime is identical. Cast
  once where you hand the handle over.
- **Share an ORM's connection, don't open a second one.** Knex pins a single
  SQLite connection, and a second connection would block on SQLite's lock
  while a Knex transaction is open. Hand the library Knex's own handle.
- **A per-device or per-session key** for app state is `request.auth.session.idHash`.
- **Tests** can pass `fetch` to `createWardClient` and `fetch`/`navigate`/
  `location` to `createAuthClient`. The library's own suite runs a real Ward
  in-process and is the reference for driving the flow.

## Commands and upgrading

| Command (from this repository's root)      | What it does                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| `npm run build --workspace=shared-library` | Builds `dist/`: two bundles, two `.d.ts`              |
| `npm run vendor -- <dir>`                  | Builds, then writes the six-file copy into `<dir>`    |
| `npm test`                                 | Runs every workspace's tests, this library's included |

Every version and its upgrade notes are in [CHANGELOG.md](./CHANGELOG.md). The
library migrates its own tables on `createSqliteStore`. Never edit a shipped
migration.
