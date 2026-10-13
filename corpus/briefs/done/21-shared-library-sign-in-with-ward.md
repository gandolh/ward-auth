# Brief 21 — The shared library: Sign in with Ward

## Context

Adds the Ward half to the library from brief 20: an app's "Sign in with Ward"
button, linking, and the 30-second check that keeps revoke-everywhere for
sessions that began with Ward. The rules are in
[decisions-oidc.md](../../wiki/decisions-oidc.md). Read the sections on first
sign-in, linking and Ward-originated sessions before you start.

Depends on brief 18 (the provider and its client authentication), brief 19
(`/session-status`) and brief 20 (the library).

## Files you OWN

- `shared-library/**`
- `infrastructure/local/seed.mjs` (only to write each app's client env)
- `corpus/wiki/decisions-oidc.md`, `corpus/log.md`

## Files you must NOT touch

- `api/` and `ui/` beyond fixing a defect you find in briefs 18 or 19. Report
  it in the log if you do.

## What to do

1. **The flow, using `openid-client` (bundled):**
   - A start route stores the state, nonce and PKCE verifier in a short-lived,
     HttpOnly cookie scoped to the callback path, then redirects to Ward.
   - The callback finishes the code exchange with the client authentication
     brief 18 chose, and verifies the ID token with `alg` pinned to `EdDSA`.
   - Then it resolves the local user:
     1. A linked user with that `sub` signs in.
     2. Otherwise, if a local user is signed in and the flow was started from
        settings as "link", link the Ward subject to that user.
     3. Otherwise create a new local user linked to `sub`, with username from
        `preferred_username` (suffixed if taken) and role from `ward_role`.
   - **Never match on username.**
   - The app session row records `ward_sid` and that it is Ward-originated.
2. **`access_denied` and every other provider error** lands on a route that
   sends the person back to the app's login page with an error code the hooks
   expose. The app writes its own message.
3. **The 30-second check.** On each request with a Ward-originated session,
   call `/session-status`, cached 30 seconds per `wardSid`, with concurrent
   calls collapsed. Fail closed: Ward down, a timeout or a malformed answer
   ends the request as signed out, with a reason code `ward_unavailable` that
   the login page can show as "Ward is unreachable, sign in with your
   password". A `401` gets its own error naming the client configuration.
   Local sessions never call Ward.
4. **Settings actions:**
   - Link Ward (starts the flow in link mode).
   - Unlink Ward: refused while the user has no local password.
   - Set a local password: for users created from Ward. It needs a fresh Ward
     sign-in, or the current password if there is one.
   - Sign out of Ward too (RP-initiated logout).
5. **Mail:** `sendNotification({ subject, mailSubject, text })` with client
   authentication, for linked users only. Throw `WardUnavailableError` on a
   transport failure, as `client/` does.
6. **React hooks:** `useWardSignIn` (the button's handler and the error code),
   `useWardLink`, `useWardUnlink` and `useSetLocalPassword`.
7. **Configuration:** issuer, client id, the client's private key (or
   whichever credential brief 18 chose) and the redirect URI. The issuer is
   discovered once and cached. None of it may assume Ward shares the app's
   origin.
8. **The local seed** writes each app's client env into its gitignored env
   file, as it writes the Ward trio today.
9. **Write `shared-library/README.md` as the adoption guide** that briefs 22–26
   follow. It replaces [integrating.md](../../wiki/integrating.md) for new
   work. It covers:
   - Vendoring the build and importing it by relative path.
   - Handing over the SQLite handle.
   - Registering the plugin and the allowlist.
   - Cookie scoping.
   - The env variables.
   - Seeding local users.
   - Migrating rows keyed by a Ward subject, by reusing the subject as the
     local id.
   - Removing the old Ward module and the dev `/ward` proxy.
   - Building the login and settings pages on the hooks.

   Name no domain and no local path.

## Acceptance

- Against a real Ward started in tests (as `api/src/integration` does today):
  - A first sign-in creates a linked user with the grant's role.
  - A second sign-in reuses that user.
  - Link mode links the signed-in local user.
  - A same-named local user is never linked automatically.
  - No grant gives the `access_denied` error code.
- Revoking the Ward session ends the app session on the first request after
  the 30-second cache expires. With Ward stopped, a Ward-originated session is
  rejected with `ward_unavailable`, and a local session keeps working.
- Unlink without a local password is refused.
- The library's suite, Ward's suite, typecheck and lint pass. The vendored
  build still needs no install step of its own.

## Outcome (2026-10-13)

Shipped as shared library 0.2.0, with `openid-client` 6.8.8 bundled in. Done:
- Sign-in, link, reauthenticate, unlink, set local password and "sign out of
  Ward too" routes.
- Migration 2: `auth_ward_links`, and `auth_sessions.ward_id_token` for the
  end-session hint.
- The 30-second `/session-status` check as a session validator, failing closed
  with `ward_unavailable`.
- `notifyUser`, and the React hooks.
- The adoption guide in `shared-library/README.md`, which replaces
  integrating.md for new work.

Deviations:
- **The callback lives under the app's API prefix**
  (`<API prefix>/auth/ward/callback`), not under the UI path. A link callback
  needs the session cookie, which is scoped to the API prefix. The seed
  carries each app's dev API prefix, and the controller fixed the stale
  example in `oidc.mdx` and the console placeholder.
- **There is a fifth, optional variable,
  `WARD_OIDC_POST_LOGOUT_REDIRECT_URI`.** Ward's end-session request needs the
  exact registered URI.
- **The build calls are in decisions-oidc-build.md.**

Verified by the controller: 1243 tests, typecheck, lint, build and corpus lint
clean. Docker became available during the run, so the local container was
rebuilt and `seed.mjs` was run for real. It registered all five apps as
clients with the new callback URIs and wrote their env files, which were backed
up first outside the repo. Discovery on `localhost:8792` advertises the
prefixed issuer, `private_key_jwt` and `EdDSA`.
