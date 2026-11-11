# Brief 03 — The house style and the quality harness

**Depends on:**

- In ward-auth: nothing. This brief runs first. No Base UI bump brief exists: see "The pin" below.
- In the owner's skills library:
  - brief 27, *A house style, and a quality harness that enforces it*: the `house-style` configs at `v1.0.0` (vendored into each repo, decision 1) with their `house-style:sync` script, the `house-style` skill, and the plugin's `Stop` and `PostToolUse` hooks;
  - brief 15, *Enforce the base-ui and code-structure skills in every repo*: how the convention checkers are wired and when they run `--warn-only`.
- The owner's grilling of 2026-11-10, questions Q5-Q14 and Q45-Q51 of the skills library's open questions. All decided; see Owner decisions.

**Runs before:** 04, 05 and 06. The reformat and the `!` fixes touch files those briefs rewrite or move, so they go first.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

On 2026-11-09 the owner decided, for every web app: Base UI 1.9.0 everywhere, the whole app on Tailwind v4, and the researched conventions enforced in each repo. Brief 27 of the skills library names the house style and a two-layer harness: the repo's gate (`npm run check`, and `npm run check:fast`), and the Claude Code layer (the plugin's `Stop` and `PostToolUse` hooks, `.claude/rules/`, a short root `CLAUDE.md`). This brief adopts both in ward-auth. Briefs 04-06 then switch on their own checks inside it. Ward is the OIDC provider every app signs in through, so **nothing here changes a route, a cookie or a token format**: this brief touches formatting, configuration and the small fixes the rules ask for.

ward-auth starts further along than Almanac in one way and behind it in two:

- **Ahead:** a Prettier config and `fmt` scripts already exist, and the code is formatted at width 100 (the estate's width is 120, so the reformat in step 3 is real work: decision 2).
- **Behind:** the gate's globs leave files out, and `tsconfig.base.json` lacks the house flags.

### What ward-auth has today (read 2026-11-10)

- **Workspaces** (root `package.json`): `api`, `ui`, `docs`, `shared-library`. The 190 TypeScript files outside `docs/` are 114 `api` (50 of them tests), 43 `ui`, 34 `shared-library`, and the two root configs.
- **`tsconfig.base.json`** has `strict`, `isolatedModules`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`. It lacks `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. `api/tsconfig.json` and `shared-library/tsconfig.json` set `NodeNext`; `ui/tsconfig.json` sets `ESNext`/`bundler`.
- **`eslint.config.js`** (82 lines): `@eslint/js` recommended, `typescript-eslint` recommended (untyped, 8.69.0), `eslint-plugin-react-hooks` 7.1.1 on `ui/src` and `shared-library/src/react` with `set-state-in-effect` and `refs` as errors, a Node-globals block for `shared-library/scripts/**/*.mjs`, and `_`-prefixed unused names. **Its header is the house philosophy and this brief keeps it:** the config is deliberately thin because the compiler is the primary gate, a rule that duplicates the compiler is worse than absent, and a gate that covers less than it appears to is worse than none. Every rule added below is one the compiler cannot see.
- **Prettier 3.9.6**, `.prettierrc.json` is `{ "printWidth": 100 }` (it becomes 120, decision 2). `fmt` and `fmt:check` use globs that leave out, among tracked files: `ui/vite.config.ts`, `eslint.config.js`, `shared-library/scripts/vendor.test.ts`, `infrastructure/local/seed.mjs`, and everything under `docs/` (5 TypeScript, JavaScript and CSS source files: `docs/docusaurus.config.ts`, `docs/sidebars.ts`, `docs/scripts/build-diagrams.mjs`, `docs/scripts/sync-corpus.mjs`, `docs/src/components/Diagram.tsx`, plus `docs/src/css/custom.css`).
- **`lint`** covers `api/src`, `ui/src`, `shared-library/src` and `shared-library/scripts`. It leaves out `eslint.config.js`, `vitest.config.ts`, `ui/vite.config.ts`, `infrastructure/local/seed.mjs` and `docs/`.
- **Scripts:** `typecheck` runs each workspace's own script (`npm run typecheck --workspaces --if-present`); `test` is `vitest run` with `pool: "forks"` over `api`, `ui` and `shared-library`; there is no `check`.
- **No `.npmrc`, no root `CLAUDE.md`, no `.claude/`.** The only `CLAUDE.md` is [CLAUDE.md](../../CLAUDE.md), which Claude Code reads only once an agent opens a file under `corpus/`. It holds the numbering note and the brief-board line, and no commands. Dependencies are still exact-pinned: every `package.json` spec is a bare version.
- **The Docker image** (`infrastructure/Dockerfile:25-57`) runs `npm ci` twice (`deps` and `proddeps`) in `node:24-alpine`, with only `python3 make g++` added by `apk add` (lines 29 and 50). **There is no `git`.** A `github:` dependency would fail both stages, which is why `house-style` is vendored (decision 1). The image copies only `api/` and the manifests of `ui/`, so a root devDependency must resolve at `npm ci` without a build step.
- **One known failing test** since 2026-11-01: `shared-library/scripts/vendor.test.ts` expects README wording `vendor.mjs` no longer writes ([wiki/status.md](../../wiki/status.md), Known issues). The gate cannot be green until it is fixed, so step 1 fixes it.

### The pin: no bump brief

Checked 2026-11-10 with `grep -rn "base-ui" --include=package.json .` and the lockfile:

- the one use is `ui/package.json:14`, `"@base-ui/react": "1.9.0"`;
- `package-lock.json` resolves `node_modules/@base-ui/react` at 1.9.0 and `@base-ui/utils` at 0.5.0;
- no source file, doc or config names `OTPFieldPreview`, `otp-field` or `sanitizeValue` (`grep -rniE "OTPFieldPreview|otp-field|sanitizeValue" --include=*.ts --include=*.tsx --include=*.md --include=*.json .`, excluding the lockfile, prints nothing).

So brief 04 of the skills library has nothing to do here.

### Measured on 2026-11-10

Taken on a scratch copy of `HEAD` (`d92ea13`) with `npm ci --ignore-scripts` for `api`, `ui` and `shared-library`, so `better-sqlite3` was not built and **no test was run**. Prettier was 3.8.1 (the repo pins 3.9.6); TypeScript 6.0.3 and ESLint 10.9.1 were the repo's.

**Prettier churn** over the 198 tracked `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css` and `.html` files outside `docs/` (53,625 lines), `trailingComma` default:

| `printWidth` | Lines changed | Files changed |
|---|---|---|
| **100 (today's)** | **30** | **7** |
| 120 | 2,312 | 135 |
| 130 | 2,793 | 141 |

At 100, six of the seven files are covered by the `fmt` globs and differ only because of the 3.8.1 against 3.9.6 gap (`api/src/db/audit-log.ts` 3 lines, `ui/src/pages/Verify.tsx` 5, `shared-library/src/store/sqlite.ts` 2, and three one-line files); the seventh is `infrastructure/local/seed.mjs`, 17 lines, outside the globs. Unlike Almanac, **ward-auth is already formatted at 100, so moving to the estate's width of 120 is the expensive choice**, and it is the one decided (decision 2): the one-off reformat is the 120 row, **2,312 lines in 135 files**. CSS and HTML are in those counts; `docs/` was not measured. The Prettier version gap makes the exact count at the pinned 3.9.6 a little different, and step 3 records it.

**TypeScript flags**, `tsc -p <workspace> --noEmit` with the flag on the command line:

| Flag | `api` | `ui` | `shared-library` |
|---|---|---|---|
| `noUncheckedIndexedAccess` | 0 | 0 | 0 |
| `verbatimModuleSyntax` | 0 | 0 | 0 |
| `erasableSyntaxOnly` | 2 | 0 | 3 |
| `exactOptionalPropertyTypes` (not proposed) | 8 | 14 | 2 |

The five `erasableSyntaxOnly` errors are all parameter properties: `api/src/oidc/adapter.ts:133, 134` (`SqliteAdapter`), `shared-library/src/ward/errors.ts:53` (`WardSignInError`), `shared-library/src/testing/ward-harness.ts:287, 288`. `docs/` has its own `tsconfig.json` and was not measured.

**Typed and house rules**, one ESLint run over `api/src`, `ui/src`, `shared-library/src` and `shared-library/scripts` with the rules below at `error` and `parserOptions.projectService`. **Re-measured on 2026-11-10** on a scratch copy of `HEAD` (`5234256`) with `npm ci`, `noUncheckedIndexedAccess` on, ESLint 10.9.1, typescript-eslint 8.69.0, `eslint-plugin-n` 18.5.0 and `@vitest/eslint-plugin` 1.6.28: 17.5 s cold for all of it (with the `n` and vitest plugins), 3.8 s for `api/src/app.ts` alone. A split of source, tests (`*.test.ts`, `*.test.tsx`) and `shared-library/src/testing/ward-harness.ts` (the harness):

| Rule | Source | Tests | Harness |
|---|---|---|---|
| `no-floating-promises` | 0 | 0 | 0 |
| `no-misused-promises` | 0 | 0 | 0 |
| `await-thenable` | 0 | 1 (`api/src/routes/auth.test.ts:1028`) | 0 |
| `switch-exhaustiveness-check` | 3 (`ui/src/pages/Account.tsx:73`, `Login.tsx:71`, `Register.tsx:67`) without `considerDefaultExhaustiveForUnions`; **0 with it** (decision 5) | 0 | 0 |
| `consistent-type-imports` | 0 | 71 in 13 files (autofixable) | 0 |
| `no-unnecessary-type-assertion` | 4 (`api/src/oidc/adapter.ts:179`, `api/src/tokens/keys.ts:239`, `api/src/tokens/verify.ts:143`, `ui/src/console-api.ts:459`) | 16 | 0 |
| `@typescript-eslint/no-non-null-assertion` | **32** | **351** | **9** |
| `no-console` | 5 (`api/src/config.ts:341`, `api/src/oidc/client-keygen.ts:60, 64`, `api/src/tokens/keys.ts:302, 382`) | 3 (`api/src/integration/estate.test.ts:554-556`) | 0 |
| `no-process-env` | 3 (`api/src/config.ts:329`, `shared-library/src/fastify/plugin.ts:666`, `shared-library/src/ward/client.ts:548`) | 214 | 12 |
| `no-restricted-syntax` on `TSEnumDeclaration`, `no-warning-comments` | 0 | 0 | 0 |
| `@vitest/eslint-plugin` recommended (tests only), with `valid-expect` at `maxArgs: 2` and `expectRefused` in `expect-expect`'s `assertFunctionNames` | | 14: `no-conditional-expect` 10 (`api/src/auth/cookie.test.ts:179, 180`, `api/src/auth/refresh.test.ts:133, 224, 346, 348, 403, 404`, and others), `no-standalone-expect` 4 (`api/src/oidc/oidc.test.ts:116, 144, 145`, `api/src/routes/admin/gate.test.ts:81`) | |

Every other row re-measured with the same numbers as before. The vitest row needed two settings to be honest: tests call `expect(value, "message")`, which `valid-expect` flags 54 times at its default `maxArgs: 1` (vitest allows the second argument), and `api/src/routes/session-status.test.ts:320` defines `expectRefused`, a helper that asserts, so `expect-expect` reports 4 tests until the helper is named. Three things in that table matter:

- **The order matters for `no-unnecessary-type-assertion`.** Without `noUncheckedIndexedAccess` it finds 10 in source and 117 in tests, nearly all `!` on indexed access (`roles[0]!`, `bracketed[1]!`). With the flag on, the `!` is needed and the count drops to the 4 and 16 above. Turn the flag on first.
- **`no-non-null-assertion` finds 392, not Almanac's 9** (32 source, 9 harness, 351 tests, re-measured). That is far past brief 27's "about 20" line, and Q47 answers it: an error in source, a warning in tests (decision 6). Almanac's counts must not be assumed here.
- **`considerDefaultExhaustiveForUnions: true` clears the three `switch` findings** (3 without it, 0 with it, re-measured), because those switches have a deliberate `default` over a union that is open to new codes.

**House shapes**, counted with the TypeScript parser over the 190 files:

| Shape | Count | Where |
|---|---|---|
| `enum` | 0 | |
| `any` (the keyword) | 0 | |
| `@ts-ignore` / `@ts-nocheck` | 0 / 0 | |
| `@ts-expect-error` | 3 | `api/src/tokens/service.test.ts:27, 109, 113`; each needs a description under `ban-ts-comment`'s house form |
| `TODO` / `FIXME` / `XXX` / `HACK` | 0 | |
| `eslint-disable` | 6, all `no-control-regex` | `api/src/mail/transport.ts:223`, `api/src/routes/notify.ts:192, 196`, `ui/src/lib/next.ts:149, 163`, `shared-library/src/core/paths.ts:21` |
| default exports | 2 | `ui/vite.config.ts:13`, `vitest.config.ts:17`; both are configs. `eslint.config.js` is a `.js` file the TypeScript count skips |
| `declare module "fastify"` | 1 | `shared-library/src/fastify/plugin.ts:123`, an augmentation, which `no-namespace` allows |
| parameter properties | 5 | see the flag table |
| `void` calls | 34 | the code marks discarded promises |

**Not measured:** the test suite (no native build), `npx knip`, `docs/` (its dependencies are not installed), and `check`'s full run time. The ESLint counts above are the only numbers re-measured on 2026-11-10; the Prettier, TypeScript-flag and house-shape counts are as first measured at `d92ea13`. `typecheck` over the three workspaces takes 8.8 s cold, so `check:fast` should land near 12 s. Step 1 measures the rest.

## Owner decisions

Decided on 2026-11-10 unless marked as a default.

1. **Where the configs come from** (Q6, decided 2026-11-10, technical call). `house-style` is **vendored**: ward-auth holds a copy with a version header, refreshed by a `house-style:sync` script that finds the `house-style` checkout by name, the way Ward's own shared library is vendored into the apps. It is not a git, `github:` or tarball dependency. The Docker image has no `git` and runs `npm ci` in two stages, and npm locks GitHub dependencies as git URLs, so a dependency would need `git` (or SSH) in every build. **The Dockerfile is not touched by this brief.** The copy, its sync script and the version header come from brief 27; the vendored copy is excluded from Prettier, ESLint and knip.
2. **Width: 120** (Q8 and Q51, decided 2026-11-10, technical call). One estate width. ward-auth is the one measured repo already formatted at 100, so the reformat is large (2,312 lines in 135 files, the measured table above) and is the one-off cost of the estate sharing a width. It is its own commit with a blame-ignore entry (step 3). `.prettierrc.json` changes to `120`.
3. **Markdown stays out of Prettier** (Q45, decided 2026-11-10, technical call). `.prettierignore` lists `*.md`, the root `README.md` included (it leaves `fmt`'s `"*.md"` glob). The corpus has its own lint.
4. **tsconfig** (Q11, decided 2026-11-10, technical call). Add `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly` now (0, 0 and 5 errors; the five parameter properties become fields). `exactOptionalPropertyTypes` (24 errors) comes after a count, in a later brief. `strict` is on, and TypeScript is 6.0.3.
5. **Typed lint** (Q12 and Q48, decided 2026-11-10, technical calls). The six rules through `projectService`, with `considerDefaultExhaustiveForUnions: true` on `switch-exhaustiveness-check` (re-measured: it takes its 3 findings to 0). This honours the config header's "compiler first" rule: all six see what the compiler cannot (a floating promise, a non-exhaustive switch, an import that only erases). `no-floating-promises` names `node:test`'s `describe`, `it` and `test` in `allowForKnownSafeCalls`, which ward-auth (vitest) doesn't need.
6. **The house shapes** (Q13 and Q47, decided 2026-11-10, technical calls). All as errors, with these allowances: `console` is allowed in scripts and CLIs (the three CLI and pre-logger sites in the table); a default export is allowed where a framework needs one (config files). **`!` (`no-non-null-assertion`) is an error in source and a warning in tests**: the 41 in source and in the library's `ward-harness.ts` (it ships in the library, so it is treated as source) are fixed here, and the 351 in `*.test.{ts,tsx}` stay as warnings. `no-process-env` is an error from the start for `api/src` (its one source hit is `config.ts`, which is excepted), and brief 06 owns the exception for `shared-library` (a default). Comments as prose are checked by the review gate (Q14). Components use named exports (Q49); ward-auth's pages already do.
7. **`check:fast`** (Q10, decided 2026-11-10, technical call). A typecheck plus ESLint on the files changed against `HEAD` and the untracked ones, built incrementally (`tsc -b`). Target 15 s warm with one changed file; up to about 30 s is accepted where `tsc` alone is slower. The re-measured one-file lint is 3.8 s, and the typecheck over three workspaces 8.8 s cold, so about 12 s is expected.
8. **The Claude Code layer** (Q7, decided 2026-11-10, technical call). The plugin's hooks: `Stop` runs `check:fast`, `PostToolUse` formats the saved file. Nothing is committed to `.claude/settings.json`.
9. **A root `CLAUDE.md`** (Q46, decided 2026-11-10, technical call). Create one, and move the repo-wide parts of `corpus/CLAUDE.md` out of it: only the brief-board section is repo-wide today.
10. **A version bump for the library** (default). `shared-library/src/ward/errors.ts:53` is inside the built bundle apps vendor. Changing the parameter property to a declared field assigned in the constructor does not change the API, but it changes the built file. Default: a patch bump to 0.7.1 and a `CHANGELOG.md` entry that says "no change for apps". Still open for the owner: does a no-behaviour change to the bundle's source need a version at all?
11. **No PRs, no branches** (Q4, decided 2026-11-10, owner). One commit per step, straight on `main`. The owner reviews `main`.

## Files you OWN

- `tsconfig.base.json`.
- `eslint.config.js`, keeping its header and adding the new rules in the same style.
- `.prettierrc.json` (the width becomes 120), new `.prettierignore` and `.git-blame-ignore-revs`, the vendored `house-style` copy and the `house-style:sync` script entry.
- The root `package.json` (scripts, devDependencies) and `package-lock.json`.
- The reformat and the fixes the new rules ask for:
  - `api/src/oidc/adapter.ts:133-134`, `shared-library/src/ward/errors.ts:53`, `shared-library/src/testing/ward-harness.ts:287-288` (the parameter properties);
  - the 3 `switch` sites in `ui/src/pages/`, the 4 source and 16 test unnecessary assertions, the `await-thenable` site, the 71 `import type` sites, the 3 `@ts-expect-error` descriptions;
  - the 41 source and harness `!` (decision 6); the 351 in tests stay as warnings;
  - `api/src/config.ts:341`, `api/src/oidc/client-keygen.ts:60, 64` and `api/src/tokens/keys.ts:302, 382`, only to record them as CLI or pre-logger output in the config's override, not to change them.
- `shared-library/scripts/vendor.test.ts` and `shared-library/scripts/vendor.mjs` (whichever holds the stale README wording).
- `shared-library/package.json` version and `shared-library/CHANGELOG.md` (decision 10).
- New: `.claude/rules/ui.md`, `.claude/rules/api.md`, `.claude/rules/shared-library.md`, root `CLAUDE.md`, `scripts/check-fast.mjs` if the package ships none, and `scripts/conventions.json` if an exception is needed.
- [CLAUDE.md](../../CLAUDE.md): its brief-board section moves out.
- Corpus: [wiki/decisions-implementation.md](../../wiki/decisions-implementation.md) (a new entry), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- Behaviour. Apart from the fixes above, every change is formatting or configuration. In particular, **no route, cookie or token format changes**.
- `infrastructure/Dockerfile` (decision 1 needs no change to it).
- `api/src/config.ts`'s reading of the environment (brief 06).
- The CSS and the class names (briefs 04 and 05) and the layout of `api/src` (06).
- `docs/`. Its Docusaurus scripts and CSS are out of the harness's scope; record any `docs/` file the new globs would reach in the outcome note.
- The skills library and the `house-style` repo. A rule that seems wrong for ward-auth is reported back, not patched here.

## What to do

One commit per step, straight on `main`, each with `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` green.

1. **Measure and unblock.**
   - Fix the failing `shared-library/scripts/vendor.test.ts` (it expects the old README wording), so the gate starts green.
   - Run the test suite, `npx knip` from the `house-style` preset, and `@vitest/eslint-plugin` recommended with `assertFunctionNames: ["expect", "expectError"]` (check what helper the tests use first: `grep -rn "function expect" api/src ui/src shared-library/src`).
   - Re-run the typed-rule table above on the real tree (it was re-measured on 2026-11-10 on a scratch copy) and time `check:fast`'s two halves.
   - Record every number in the `log.md` entry. A rule that finds more than about 20 real problems, or mostly false ones, goes back to the owner before it is turned on: `no-non-null-assertion` is already one.
2. **Widen the existing gates before adding anything.** Make `fmt`, `fmt:check` and `lint` cover the files today's globs miss: root configs, `ui/vite.config.ts`, `infrastructure/local/seed.mjs`, `shared-library/scripts/vendor.test.ts`. Replace the per-glob lists with `prettier --check .` and a `.prettierignore` (`*.md`, `dist/`, `node_modules/`, `shared-library/.scratch/`, `package-lock.json`, `corpus/`, `docs/`, the vendored `house-style` copy), and run `eslint .`. **Check that each file the old globs missed is now reached**, with a deliberate mis-format in `ui/vite.config.ts`: the repo has been bitten by a gate that covered less than it looked ([wiki/decisions-implementation.md](../../wiki/decisions-implementation.md)).
3. **Prettier, and the reformat.** Vendor `house-style` (decision 1), pin the 3.9.6 already in the lockfile, set the width to 120 (decision 2), and run `npm run fmt`. Expect about 2,300 lines in about 135 files, none of them behaviour: the one-off cost. Commit that alone as `style: format with Prettier`. Add its full hash to `.git-blame-ignore-revs` in its own commit, and hand the owner `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
4. **tsconfig.** Add the three flags from decision 4 to `tsconfig.base.json`, one commit.
   - Fix the five parameter properties: a declared field assigned in the constructor, same `readonly`, same behaviour. Run `api`'s `SqliteAdapter` tests and the library's tests after.
   - Bump the library per decision 10 in this commit's neighbour, never the same commit as an unrelated change.
   - `npm run build` and `docker build -f infrastructure/Dockerfile .` must still pass.
5. **ESLint.** Extend the house config (decision 1) and add, in the config's own style (one comment saying why each rule is there):
   - the six typed rules (with `considerDefaultExhaustiveForUnions: true`), `projectService` with `allowDefaultProject` for `vitest.config.ts` and `eslint.config.js`, and `disableTypeChecked` for `shared-library/scripts/*.mjs` and `infrastructure/local/seed.mjs`;
   - `no-restricted-syntax` on `TSEnumDeclaration`, `no-warning-comments` (`todo`, `fixme`, pointing at `corpus/todos/`), `no-console` outside the three CLI and pre-logger sites in the table, `no-default-export` outside `*.config.*`;
   - `no-process-env` for `api/src` outside `config.ts` and tests, and `no-non-null-assertion` per decision 6;
   - `@vitest/eslint-plugin` recommended on `*.test.{ts,tsx}`, with `valid-expect`'s `maxArgs: 2` and `expectRefused` in `expect-expect`'s `assertFunctionNames`; fix its 14 findings (10 `no-conditional-expect`, 4 `no-standalone-expect`) or list each with its reason;
   - `ban-ts-comment` allowing `@ts-expect-error` only with a description.

   Fix what the rules find in source; list each finding left, with its reason, in the outcome note. `react-hooks` and `no-explicit-any` stay as they are.
6. **The gate.** In the root `package.json`:
   - `check` runs `typecheck`, `lint`, `format:check` (renamed from `fmt:check` only if the owner agrees; otherwise keep the name), `check:conventions` and `test`;
   - add the `house-style:sync` script beside them;
   - `check:conventions` is knip plus the two checkers from the vendored `house-style` copy; `check-base-ui` runs `--warn-only` until brief 05 is done and `check-structure` until brief 06 is done;
   - `check:fast` runs the typecheck, then ESLint on the files changed against `HEAD` plus untracked ones. No shell-only syntax: the owner works on Windows under WSL.

   Time `check:fast` warm with one changed file, and `check` in full, and record both.
7. **`.claude/rules/`**, each under about 40 lines, with `paths:` frontmatter:
   - **`ui.md`** (`ui/src/**`): Base UI only in the console and only through its wrappers (brief 04); the sign-in pages import none; the `data-wc-focus` rule after a write; the console is its own dark surface and the public pages follow the Light / Dark / System switch brief 05 adds (brief 05 rewrites this line); `console.css` and `ward.css` are replaced in brief 05, which adds the Tailwind lines.
   - **`api.md`** (`api/src/**`): `config.ts` is the only reader of the environment; the lazy `await import("../config.js")` is deliberate (18 sites; `buildApp` must not touch the database or the config before `index.ts` has migrated); failures keep the repo's error bodies; a malformed body is not a lockout failure; the lockout key is never `request.ip`; the OIDC provider is mounted through `oidc/routes.ts` and nothing else; tests drive `buildApp()` over `inject()`. Brief 06 adds the structure lines.
   - **`shared-library.md`** (`shared-library/src/**`): apps vendor this, so an API change needs a version, a `CHANGELOG.md` entry with an upgrade note, and `npm run vendor` is how it ships; no Fastify or React import in `core/`; no `process.env` outside the two documented fallbacks.
8. **`CLAUDE.md`** at the root, under about 60 lines: one line on what Ward is; "read `corpus/index.md` first"; the commands (`npm run dev`, `npm run check` before every hand-back, `npm run check:fast`, `npx vitest run <file>`, `npm run keygen`, `npm run vendor`); the places that mislead (the API on 8791 and the UI on 5174, `ui` is not in the Docker image, `docs` is a workspace without `"type": "module"`, the `shared-library` bundle is what apps copy); the moved brief-board section. [CLAUDE.md](../../CLAUDE.md) keeps the numbering note and the code-comment rule.
9. **Corpus.** Add the entry "The house style, formatted and checked" to [wiki/decisions-implementation.md](../../wiki/decisions-implementation.md) (width, config source, the compiler-first rule kept, what was rejected: `recommendedTypeChecked` as a whole, `exactOptionalPropertyTypes`, Markdown under Prettier), update [wiki/status.md](../../wiki/status.md) and [log.md](../../log.md), and run `bash corpus/lint.sh` until it is clean.

## Acceptance

- [ ] `npm run check` passes, and its time and `check:fast`'s (warm, one changed file) are in the outcome note. `check:fast` is under about 15 s, or the owner accepted the time.
- [ ] `npx prettier --check .` passes at width 120, and the reformat commit changes whitespace only (`git diff -w <hash>^ <hash>` shows nothing outside it); its hash is in `.git-blame-ignore-revs`.
- [ ] `tsconfig.base.json` has `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`; `npm run typecheck` and `docker build -f infrastructure/Dockerfile .` pass.
- [ ] A deliberate mis-format in `ui/vite.config.ts`, an `enum`, a `console.log` in `api/src/app.ts`, a `// TODO` and an `export default` in `api/src/app.ts` each fail `npm run check`. Revert them after.
- [ ] `npm run lint` reports zero errors, with the table's counts before and after in the outcome note and every finding left listed with its reason.
- [ ] `git diff --stat -- infrastructure/Dockerfile` is empty, and no `package.json` holds a git, `github:` or tarball dependency on `house-style`.
- [ ] `.claude/rules/ui.md`, `api.md` and `shared-library.md` exist with `paths:` frontmatter, and the root `CLAUDE.md` lists `npm run check` and is under about 60 lines.
- [ ] With the plugin's hooks on, an agent's edit is formatted on save, and a type error stops it at `Stop`.
- [ ] `bash corpus/lint.sh` ends clean.

## Interplay

- **Brief 04** adds nothing to the gate. **Brief 05** adds `better-tailwindcss` and drops `check-base-ui`'s `--warn-only`; its `fmt` glob loses `ui/src/**/*.css` except `ui/src/styles/index.css`. **Brief 06** drops `check-structure`'s `--warn-only`, ~~adds dependency-cruiser~~ and records the `shared-library` `process.env` exceptions. *(2026-11-11: dependency-cruiser landed in this brief, by the controller's ruling, as `.dependency-cruiser.cjs` and in `check:conventions`, with `no-circular` a dated warning for the library's one type-only cycle; brief 06 keeps its features-against-domain-modules rules and the cross-feature check. `format` and `format:check` run over `.`, so brief 05 has no glob to change.)*
- The skills library's brief 25 (the security audit) runs on ward-auth first, by the owner's answer of 2026-11-10 (Q34): one focused run of about an hour on the login, session and token code, and its findings become ward-auth briefs. It reads the same tree, so it should run after this reformat and sees formatted code and a typed lint; this brief changes no behaviour for it to re-run against, apart from the five parameter properties.
- The reformat touches files every later brief rewrites. Run it when no other brief has uncommitted work.

## Outcome

Built on 2026-11-11 on `main`, committed and not pushed, with house-style
1.1.0 (library commit `e9de59a`). Commits, in order: `eee7d66` the vendor
test's wording, `881aa81` the copy and the pins, `2396c0e` `lint` over `.`,
`4a16054` Prettier at 120 over `.`, `25252ac` `style: format with Prettier`,
`38a9327` the blame-ignore file, `98edcf5` the tsconfig flags, `031b145` the
source `!` as guards, `b4a12f0` ward-auth 0.7.1, `ee01889` the house ESLint
config, `e9dc609` the gate, `870fbd2` the incremental typecheck, `d1201f4`
the root `CLAUDE.md` and `.claude/rules/`, `718dcf1` the decisions entry,
`8c4e0ad` the changelog's banner line, `cc126ec` brief 06's note, then this
closeout.

**Measured** at `881aa81`, the flags on: tsc `noUncheckedIndexedAccess` 0,
`verbatimModuleSyntax` 0, `erasableSyntaxOnly` 5 (api 2, library 3),
`exactOptionalPropertyTypes` 24 (8, 14, 2), as the brief says. The test suite
had the one known failure (1235 of 1236), fixed first.

**Lint, before and after** (house config; source / tests / harness):

| Rule | Before | After |
|---|---|---|
| `no-non-null-assertion` | 32 / 351 (warn) / 9 | 0 / 345 (warn) / 0 |
| `no-unnecessary-type-assertion` | 4 / 16 / 0 | 0 |
| `n/no-process-env` | 2 / 0 / 12 | 2 / 0 / 12, warnings |
| `no-console` | 0 / 3 / 0 | 0 |
| `vitest/no-standalone-expect` | 0 / 4 / 0 | 0 |
| `await-thenable` | 0 / 1 / 0 | 0 |
| `consistent-type-imports` | 0 / 1 / 0 | 0 |
| every other rule | 0 | 0 |

84 errors and 351 warnings before; 0 errors and 359 warnings after. The
warnings left: the 345 test `!` (decision 6), and `n/no-process-env` on
`shared-library/src/fastify/plugin.ts`, `ward/client.ts` (the two documented
fallbacks) and the harness's 12 writes, in a dated block until the
library's exceptions are recorded. The brief's other counts, as found:
`consistent-type-imports` 71 are `typeof import()` annotations the house
allows (1 real); `@ts-expect-error` is 1 directive, already described (the
other 2 are prose); `vitest/no-conditional-expect` is off in the house, so its
10 are not findings; `switch-exhaustiveness-check` 0 with the house option.
7 of the 20 dead assertions were `response.json() as T`, which the rule wants
as `json<T>()` and doesn't fix itself.

**Each `!` in source** guards a value that is always there: the db layer's
`INSERT … RETURNING *` and `count(*)` (`requireRow` in `db/prepared.ts`),
`config.ts`'s refined variables (`refined()`), the console's re-read rows
(after the transaction for disable and enable, so it commits and then fails
as `accountView(undefined)` did; inside it for rename and the two app
writes, where the row was used next), and the rest narrowed in place. The
compiled API differs from the commit before only by those guards; the
React bundle is unchanged; the server bundle differs in `migrateSqlite`'s
last migration and `wardClientOptionsFromEnv` (same checks and `TypeError`).
So the library took 0.7.1, no change for apps; the parameter property alone
would not have needed it (its built class is byte for byte the same).

**The reformat:** 138 files, 2,323 lines out and 996 in, Prettier 3.9.10.
`git diff -w` is not empty (rewrapped lines show under it), so the bundle
compare stands in: 209 code, CSS, JSON and YAML files, esbuild-minified and
JSON and YAML parsed, 202 identical. The 7 that differ are UI pages
(`Login.tsx`, `Register.tsx`, console `AccountDetail.tsx`, `AppDetail.tsx`,
`Apps.tsx`, `Login.tsx`, `OidcClient.tsx`) whose JSX text Prettier rejoined or
split with `{" "}`: the same rendered text. The built library bundles,
minified, are identical before and after.

**Checkers and tools.** knip: 0 unused files and dependencies; 25 unused
exports, 26 types, 1 duplicate (warnings); `docs` in `ignoreWorkspaces`, the
unused `api/src/tokens/index.ts` barrel in `ignore` with a dated note.
dependency-cruiser: 211 modules, 1,019 dependencies, one `no-circular`
(`shared-library/src/fastify/plugin.ts` ↔ `fastify/ward.ts`, type-only), a
dated warning. `check-base-ui` strict: 6 errors (rule 3 ×3: console
`Accounts.tsx:18`, `Apps.tsx:27`, `ui.tsx:21`; rule 5 ×3: `console.css`,
`tokens.css`, `ward.css`), so `--warn-only`. `check-structure` strict: 74
errors and 23 warnings (rule 1 ×1 `api/src/index.ts:39`, rule 3 ×2 the
library's fallbacks, rule 6 ×71 in the route files, rule 11 ×23), so
`--warn-only`.

**Timings:** `npm run check` 45.4 s warm (57.7 s at load average 12);
`check:fast` 8.3-9.0 s with one API file changed, 9.8 s with one UI file,
5.6 s with nothing changed; `typecheck` 6.1 s warm, 11.3 s cold (12 s before,
every time); `eslint .` about 20 s cold; knip 1.9 s; dependency-cruiser 2.2 s.

**Checks run:** `npm run check` (exit 0, 1236 tests), `npm run build`,
`npx prettier --check .`, `npm run house-style:sync -- --check`, the bundle
compares above, a mis-format in `ui/vite.config.ts` failing `format:check`
(exit 1), an `enum`, a `!`, a `console.log`, a `// TODO` and an
`export default` in `api/src/app.ts` each failing `npx eslint` (exit 1),
reverted; api's `tsc` in a copy holding only what the image copies (exit 0);
`git diff 137c4be -- infrastructure/Dockerfile` empty; no `package.json` with
a git, `github:` or tarball dependency; the hooks run by hand with Claude
Code's event JSON (the formatter formatted a messy file and left Markdown
alone; the Stop hook exited 2 on a type error and on a `console.log`, and 0
once fixed); `bash corpus/lint.sh` clean. Under load (average 9-12),
`api/src/config.proxies.test.ts` and `config.oidc.test.ts` timed out once in
the full suite; alone they pass, and `config.proxies.test.ts` timed out at
`137c4be` under the same load, so it predates this brief.

**Checks skipped:** `docker build` (no Docker builds on this machine; the
image's compile ran on a copy instead); the live-session hook check, which
waits for the plugin update.

**Deviations:**

- `format` and `format:check`, the house names, replace `fmt` and
  `fmt:check`: the skill decides script names.
- Prettier is 3.9.10, the house pin, not 3.9.6.
- `tsconfig.base.json` holds the flags itself rather than extending the
  vendored base: the image's deps stage copies only that file.
- The format widening landed with the width change (`4a16054`), not before
  it, so the files the globs missed weren't formatted at 100 first.
- No `allowDefaultProject` or `disableTypeChecked` entries: the house config
  lints JavaScript and `*.config.*` without types.
- `typecheck` runs `tsc -p` per workspace with `--incremental` and build
  info under `node_modules/.tmp/`, not `tsc -b` (the workspaces aren't
  composite projects), then the docs site's own typecheck.
- dependency-cruiser landed here (the controller's ruling).
- `dependency-cruiser` 18.7.2 pins `semver` 7.8.6 and `acorn` 8.19.0 exactly,
  and npm hoisted both: `semver` 7.8.5 → 7.8.6 is in the image's runtime tree
  through `fastify`; `acorn` reaches only `docs/`. Asked on the board.
- `.npmrc` with `save-exact=true` is new (the skill's rule 25).
- The three `console.log` lines in `api/src/integration/estate.test.ts` are
  gone; the assertions below them carry the same values.
- The root `CLAUDE.md` has a Hard rules section, which the skill's shape has
  and this brief didn't list.
- The deliberate violations ran through `npx eslint` and `format:check`, not
  the whole `npm run check`.

**`docs/` files** the new globs would reach without the ignore: 11
(`docusaurus.config.ts`, `sidebars.ts`, `scripts/build-diagrams.mjs`,
`scripts/sync-corpus.mjs`, `src/components/Diagram.tsx`, `src/css/custom.css`,
`package.json`, `tsconfig.json` and three `diagrams/*.json`).

**Owner steps:** `git config blame.ignoreRevsFile .git-blame-ignore-revs`;
then `node cli.ts ward deploy`, from the vps-deploy checkout.
