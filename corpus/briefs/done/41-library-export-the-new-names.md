# Task 41: Library: export the names 0.5.0 and 0.6.0 added

## Context

Asked for by the owner on 2026-10-27.

ward-auth 0.5.0 ([brief 36](../done/36-library-username-for-a-new-ward-user.md))
added the `ward.usernameFor` hook and `ward.usernameMaxLength`, and 0.6.0
([brief 38](../done/38-library-disable-a-user.md)) added `disableUser` /
`enableUser`, which refuse a disabled user with `UserDisabledError`. Neither brief
had `src/index.ts` on its OWN list, so the bundle doesn't export three of the new
names:

- `UsernameFor`, the hook's type
  ([`ward/identities.ts:155`](../../../shared-library/src/ward/identities.ts)). An
  app types its hook as `WardSignInOptions["usernameFor"]` instead.
- `isUsernameMaxLength`, the check `wardAuth` runs on `usernameMaxLength`
  (same file, line 165). An app that reads its cap from the environment can't
  ask the library whether the value will be accepted before registering.
- `UserDisabledError`
  ([`core/accounts.ts:189`](../../../shared-library/src/core/accounts.ts)), thrown
  by `startSession` and `userForSignIn`. An app matches `error.code ===
  "user_disabled"` because it can't `instanceof` it.

The 0.6.0 CHANGELOG entry says the last one. The owner wants all three exported,
as a patch release. The library's one earlier patch, 0.3.1, is the model for the
CHANGELOG entry: a short summary, the changes, then "Upgrade notes from" the last
version.

## Files you OWN

- `shared-library/src/index.ts`
- `shared-library/scripts/vendor.test.ts` (the consumer probe)
- `shared-library/CHANGELOG.md` (a new 0.6.1 entry on top), `package.json` (version)

## Files you must NOT touch

- Any app's `vendor/ward/`. Each app re-vendors in its own brief.
- The 0.5.0 and 0.6.0 CHANGELOG entries: they record what those versions shipped.
- The root `package-lock.json`, which still names an older workspace version (as it
  did at 0.4.0 and 0.5.0).

## What to do

1. Export `type UsernameFor` and `isUsernameMaxLength` from `./ward/identities.js`,
   and `UserDisabledError` from `./core/accounts.js`, in their modules' existing
   export blocks.
2. In `vendor.test.ts`'s type probe (`consumer.ts`), import the three from the
   vendored `ward-auth.js` and use each, so a missing declaration fails the test.
3. Bump the version to 0.6.1 and add the CHANGELOG entry, with upgrade notes from
   0.6.0: re-vendor; nothing changes at runtime; what an app can now write instead.

## Acceptance

- The built `dist/ward-auth.js` exports `isUsernameMaxLength` and
  `UserDisabledError`, and `dist/ward-auth.d.ts` declares all three.
- The vendor smoke test's consumer compiles against them.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run fmt:check` (bar the two
  files brief 43 formats) and the library build pass.

## Outcome (2026-10-27)

Built as ward-auth 0.6.1 (`97b4c35`).

- `src/index.ts` exports `UserDisabledError` beside `InvalidUserIdError`, and
  `isUsernameMaxLength` and `type UsernameFor` beside `createWardIdentities`.
- The vendor smoke test uses all three twice: the TypeScript consumer types a hook
  as `UsernameFor`, checks a cap with `isUsernameMaxLength` and matches
  `instanceof UserDisabledError`; the `.mjs` server calls the two runtime ones and
  prints what they answer. Run against the old `index.ts`, both tests fail
  (`TS2305: Module has no exported member 'UserDisabledError'`, and the same for
  the other two).
- CHANGELOG 0.6.1 follows 0.3.1's shape. The 0.6.0 entry still says
  `UserDisabledError` isn't exported, because 0.6.0 didn't export it.
- `MIN_USERNAME_MAX_LENGTH` (10) stays unexported; the owner named three names.

Checked: the built `ward-auth.js` exports the two runtime names (`import()` of the
bundle: `isUsernameMaxLength(32)` is `true`, `new UserDisabledError().code` is
`user_disabled`) and `ward-auth.d.ts` declares all three. Typecheck, lint, the 1223
tests and the bundle build pass. `fmt:check` flags only `README.md` and
`ui/src/lib/next.test.ts`, which brief 43 formats. brief-board is down, so nothing
was posted there.
