# Task 42: Library: keep the return path through a refused Ward sign-in

## Context

Asked for by the owner on 2026-10-27, from the gap sports-app's brief 32 left open.

An app starts "Sign in with Ward" with `signIn({ returnTo })`, a same-origin path
`POST /ward/start` checks with `isLocalPath`
([`fastify/ward.ts:686`](../../../shared-library/src/fastify/ward.ts)) and keeps in
the flow cookie. On success the callback lands there. On failure it lands on
`loginPath?ward_error=<code>` and the path is gone: the flow cookie is cleared, and
nothing in the redirect carries it.

sports-app's brief 32 (`corpus/briefs/done/32-sign-in-returns-to-the-asked-screen.md`
in that repo) makes its Ward return `<base>login?next=<path>`, so a Ward sign-in comes back
through `/login` and goes on to the screen that was asked for. After a refusal the
page is `/login?ward_error=…` with no `next`, and trying again lands on `/`. Every
app that passes a `returnTo` has the same gap: atrium, satchel, shelfmark and
almanac pass the screen the person was on.

The owner wants the library to keep the path through an error redirect so the app
can retry to the same place, with the same-origin check still on it. A minor
release (0.7.0, after 0.6.1).

The failure keeps landing on `loginPath`. For most apps `returnTo` is a guarded
screen, so landing the error there would show the guard, not the error.

## Files you OWN

- `shared-library/src/core/paths.ts` (**new**: `isLocalPath`, moved out of
  `fastify/ward.ts` so the browser bundle can use it without importing Fastify code)
- `shared-library/src/fastify/ward.ts`, `fastify/ward.test.ts`
- `shared-library/src/react/client.ts`, `react/client.test.ts`, `react/hooks.ts`
- `shared-library/README.md`, `CHANGELOG.md`, `package.json` (version)

## Files you must NOT touch

- Any app's `vendor/ward/` or code. sports-app taking it up is a sports-app brief.
- The link and reauthenticate landings on `settingsPath`: they have no `returnTo`.

## What to do

1. Move `isLocalPath` to `core/paths.ts`, unchanged, and import it where it is used.
2. In the callback, every failure of a sign-in (`mode: "sign_in"`) that has a
   `returnTo` lands on `loginPath?ward_error=<code>&ward_return_to=<returnTo>`:
   the failed code exchange (`access_denied`, `invalid_callback`, `ward_unavailable`,
   `ward_misconfigured`, Ward's own codes), `sign_in_failed`, and the disabled
   user's `access_denied`. Check it with `isLocalPath` again before writing it.
   A callback with no readable flow cookie has no path to carry and is unchanged.
3. The browser client reads `ward_return_to` with `ward_error`, keeps it only when
   it passes `isLocalPath` and a `ward_error` came with it, and takes it out of the
   address bar either way. `WardResult` gains `returnTo?: string`, and
   `useWardSignIn()` returns `returnTo` (`null` when there is none).
   `clearWardResult()` (`reset()`) dismisses the error but keeps `returnTo`, so a
   "try again" after dismissing the message still goes to the same place.
4. `signIn()` without a `returnTo` behaves as before. The app decides whether to
   pass the carried one.
5. Tests: the four refusals in `ward.test.ts` (no grant, "Back to the app", a
   throwing `roleFor`, a disabled user) started with a `returnTo` come back with it
   exactly; a start without one comes back without the parameter. In
   `client.test.ts`: read and stripped beside an app's own query, an unsafe value
   (`//evil.example`, `/\evil`, `https://evil.example/`) dropped and still stripped,
   no `returnTo` without a `ward_error`, and kept across `clearWardResult()`.
6. Minor version, CHANGELOG with upgrade notes, and the README's login-page section.

## Acceptance

- A refused "Sign in with Ward" started with `returnTo: "/myapp/items/7?tab=notes"`
  lands on `/myapp/login?ward_error=access_denied&ward_return_to=%2Fmyapp%2Fitems%2F7%3Ftab%3Dnotes`,
  and `useWardSignIn().returnTo` on that page is `/myapp/items/7?tab=notes`.
- No value that fails `isLocalPath` reaches the app through the parameter.
- The browser bundle still imports nothing but `react` (the vendor smoke test).
- `npm run typecheck`, `npm run lint`, `npm test` and the library build pass.

## Outcome (2026-10-27)

Built as ward-auth 0.7.0 (`5f8328a`), on top of 0.6.1 (brief 41).

- **The parameter is `ward_return_to`**, beside `ward_error` on `loginPath`. The
  `ward_` prefix keeps it clear of an app's own query (`next`, `returnTo`). The
  failure still lands on `loginPath`, not on `returnTo` with the error on it: for
  atrium, satchel, shelfmark and almanac `returnTo` is a guarded screen, and the
  guard would hide the error.
- One helper in `fastify/ward.ts`, `landFailure`, now writes every failed round
  trip's landing: a sign-in on `loginPath` with the path, a link or
  reauthentication on `settingsPath` as before. The callback's three sign-in
  failure exits go through it (the failed code exchange, `sign_in_failed`, the
  disabled user's `access_denied`), which also removed the old `errorPage`
  local.
- The browser client reads the parameter only beside a code-shaped `ward_error`
  and only when it passes `isLocalPath`, and strips it from the address bar even
  when it drops it. `clearWardResult()` keeps `returnTo` and clears the rest, so
  `reset()` after showing the message doesn't lose the destination.
- `signIn()` doesn't default to the carried path. The app passes it, as the
  owner put it ("so the app can retry").
- `isLocalPath` moved to `core/paths.ts`, unchanged (diffed), and the browser
  bundle now carries a copy. It is still not exported.

Acceptance: a no-grant refusal started with `returnTo: "/myapp/items/7?tab=notes"`
lands on exactly
`/myapp/login?ward_error=access_denied&ward_return_to=%2Fmyapp%2Fitems%2F7%3Ftab%3Dnotes`
(`ward.test.ts`, against the harness's Ward). "Back to the app", a throwing
`roleFor` and a disabled user carry it the same way. A start without `returnTo`,
and a callback whose flow cookie is gone, land without it, and a failed link
lands on settings without it even when its start body named one. Against the old
`ward.ts` the four carrying tests fail. In `client.test.ts` the path is read and
stripped beside an app's `?next=`, kept across `clearWardResult()` (one listener
call, then none), and dropped but still stripped for `//evil.example`, `/\evil`,
`https://evil.example/`, `evil` and a newline, or with no `ward_error`. The built
`ward-auth-react.js` still imports only `react`. Typecheck, lint, 1231 tests (8
new) and the bundle build pass. `fmt:check` flags only the two files brief 43
formats.

sports-app's adoption (its login page reading `next` back out of `returnTo`) is a
sports-app brief. brief-board is down, so nothing was posted there.
