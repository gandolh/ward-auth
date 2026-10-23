# Task 36: Library: an app shapes a new Ward user's username

## Context

Promoted 2026-10-23 from the todo
[library-username-shaping-and-rename](../../todos/library-username-shaping-and-rename.md),
first bullet. Captured from the Wave C adoptions (briefs 22, 24, 25). Briefs 37 and
38 take the other two bullets.

A first "Sign in with Ward" creates a local user named from `preferred_username`
as Ward has it: up to 256 characters (`MAX_USERNAME_LENGTH` in
[`core/identifiers.ts`](../../../shared-library/src/core/identifiers.ts)) and mixed
case. `userForSignIn` in
[`ward/identities.ts:174`](../../../shared-library/src/ward/identities.ts) walks
`candidateUsernames(identity.username)`: the name, then `name-2` … `name-99`, then
random suffixes, then `ward-user-<random>`. Every candidate passes the library's
own policy, but not an app's. sports-app refuses names its sync can't store with
an app validator, so a Ward account with such a name cannot get in at all.

The plugin already passes one app hook into that call: `roleFor`, from the Ward
options in [`fastify/ward.ts:111`](../../../shared-library/src/fastify/ward.ts),
used at `:463`. A `usernameFor` hook sits beside it.

## Files you OWN

- `shared-library/src/ward/identities.ts`
- `shared-library/src/ward/identities.test.ts`
- `shared-library/src/fastify/ward.ts` (the options type and the one call site)
- `shared-library/src/fastify/ward.test.ts`
- `shared-library/README.md` (the Ward options section)
- `shared-library/CHANGELOG.md` and the `version` in `shared-library/package.json`

## Files you must NOT touch

- Any app's `vendor/ward/`. Adopting the new version in sports-app (and dropping
  its refusal) is a brief in that repo, after this one ships.
- `core/identifiers.ts`: the library's own username policy stays as it is.

## What to do

1. Add `usernameFor?: (claims: { username: string; subject: string }) => string` to
   the Ward options and to `userForSignIn` (as a second optional hook, like
   `roleFor`). Default: the identity's username, unchanged.
2. The hook's result becomes the base that `candidateUsernames` suffixes, so a
   taken shaped name still gets `-2`, `-3`, …. A result that fails the library's
   policy falls back to `ward-user`, as a bad `preferred_username` does now.
3. A hook that throws is handled like a throwing `roleFor`: logged, and the
   callback lands on the attempt's page with `ward_error=sign_in_failed`.
4. The suffix must keep an app's shape: if the hook lowercases and caps length at
   32, `name-2` must not exceed 32. Either pass a max length alongside the hook, or
   run the hook again on each suffixed candidate. Pick one and say why in the code.
5. Tests: the hook lowercases; a shaped name that is taken gets suffixed within the
   app's limit; a hook that throws lands on `sign_in_failed`; no hook behaves as
   before.
6. Bump the minor version and write the CHANGELOG entry (no breaking change, so no
   upgrade note beyond "pass `usernameFor` to use it").

## Acceptance

- A Ward identity named `Alice.Smith-With-A-Very-Long-Name` with a hook that
  lowercases and cuts to 16 gets a 16-character lowercase local name, and a second
  such identity gets a suffixed one that is still 16 or shorter.
- Existing Ward sign-in tests pass unchanged.
- `npm run typecheck`, `npm run lint`, `npm test` pass, and
  `npm run build --workspace=shared-library` builds the bundle.
