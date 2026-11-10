# Brief 03 — The house style and the quality harness

**Depends on:**

- In ward-auth: nothing. This brief runs first. No Base UI bump brief exists: see "The pin" below.
- In the owner's skills library:
  - brief 27, *A house style, and a quality harness that enforces it*: the `house-style` package at `v1.0.0`, the `house-style` skill, and the plugin's `Stop` and `PostToolUse` hooks;
  - brief 15, *Enforce the base-ui and code-structure skills in every repo*: how the convention checkers are wired and when they run `--warn-only`.
- The owner's grilling of 2026-11-10, questions Q5-Q14 of the skills library's open questions, and the new questions in decisions 2, 4, 6 and 9.

**Runs before:** 04, 05 and 06. The reformat and the `!` fixes touch files those briefs rewrite or move, so they go first.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

On 2026-11-09 the owner decided, for every web app: Base UI 1.9.0 everywhere, the whole app on Tailwind v4, and the researched conventions enforced in each repo. Brief 27 of the skills library names the house style and a two-layer harness: the repo's gate (`npm run check`, and `npm run check:fast`), and the Claude Code layer (the plugin's `Stop` and `PostToolUse` hooks, `.claude/rules/`, a short root `CLAUDE.md`). This brief adopts both in ward-auth. Briefs 04-06 then switch on their own checks inside it.

ward-auth starts further along than Almanac in one way and behind it in two:

- **Ahead:** a Prettier config and `fmt` scripts already exist, and the code is formatted at width 100.
- **Behind:** the gate's globs leave files out, and `tsconfig.base.json` lacks the house flags.

### What ward-auth has today (read 2026-11-10)

- **Workspaces** (root `package.json`): `api`, `ui`, `docs`, `shared-library`. The 190 TypeScript files outside `docs/` are 114 `api` (50 of them tests), 43 `ui`, 34 `shared-library`, and the two root configs.
- **`tsconfig.base.json`** has `strict`, `isolatedModules`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`. It lacks `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. `api/tsconfig.json` and `shared-library/tsconfig.json` set `NodeNext`; `ui/tsconfig.json` sets `ESNext`/`bundler`.
- **`eslint.config.js`** (82 lines): `@eslint/js` recommended, `typescript-eslint` recommended (untyped, 8.69.0), `eslint-plugin-react-hooks` 7.1.1 on `ui/src` and `shared-library/src/react` with `set-state-in-effect` and `refs` as errors, a Node-globals block for `shared-library/scripts/**/*.mjs`, and `_`-prefixed unused names. **Its header is the house philosophy and this brief keeps it:** the config is deliberately thin because the compiler is the primary gate, a rule that duplicates the compiler is worse than absent, and a gate that covers less than it appears to is worse than none. Every rule added below is one the compiler cannot see.
- **Prettier 3.9.6**, `.prettierrc.json` is `{ "printWidth": 100 }`. `fmt` and `fmt:check` use globs that leave out, among tracked files: `ui/vite.config.ts`, `eslint.config.js`, `shared-library/scripts/vendor.test.ts`, `infrastructure/local/seed.mjs`, and everything under `docs/` (5 TypeScript, JavaScript and CSS source files: `docs/docusaurus.config.ts`, `docs/sidebars.ts`, `docs/scripts/build-diagrams.mjs`, `docs/scripts/sync-corpus.mjs`, `docs/src/components/Diagram.tsx`, plus `docs/src/css/custom.css`).
- **`lint`** covers `api/src`, `ui/src`, `shared-library/src` and `shared-library/scripts`. It leaves out `eslint.config.js`, `vitest.config.ts`, `ui/vite.config.ts`, `infrastructure/local/seed.mjs` and `docs/`.
- **Scripts:** `typecheck` runs each workspace's own script (`npm run typecheck --workspaces --if-present`); `test` is `vitest run` with `pool: "forks"` over `api`, `ui` and `shared-library`; there is no `check`.
- **No `.npmrc`, no root `CLAUDE.md`, no `.claude/`.** The only `CLAUDE.md` is [CLAUDE.md](../../CLAUDE.md), which Claude Code reads only once an agent opens a file under `corpus/`. It holds the numbering note and the brief-board line, and no commands. Dependencies are still exact-pinned: every `package.json` spec is a bare version.
- **The Docker image** (`infrastructure/Dockerfile:25-57`) runs `npm ci` twice (`deps` and `proddeps`) in `node:24-alpine`, with only `python3 make g++` added by `apk add` (lines 29 and 50). **There is no `git`.** A `github:` dependency would fail both stages. The image copies only `api/` and the manifests of `ui/`, so a root devDependency must resolve at `npm ci` without a build step.
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

At 100, six of the seven files are covered by the `fmt` globs and differ only because of the 3.8.1 against 3.9.6 gap (`api/src/db/audit-log.ts` 3 lines, `ui/src/pages/Verify.tsx` 5, `shared-library/src/store/sqlite.ts` 2, and three one-line files); the seventh is `infrastructure/local/seed.mjs`, 17 lines, outside the globs. Unlike Almanac, **ward-auth is already formatted at 100 and moving to a wider estate width is the expensive choice.** CSS and HTML are in those counts; `docs/` was not measured.

**TypeScript flags**, `tsc -p <workspace> --noEmit` with the flag on the command line:

| Flag | `api` | `ui` | `shared-library` |
|---|---|---|---|
| `noUncheckedIndexedAccess` | 0 | 0 | 0 |
| `verbatimModuleSyntax` | 0 | 0 | 0 |
| `erasableSyntaxOnly` | 2 | 0 | 3 |
| `exactOptionalPropertyTypes` (not proposed) | 8 | 14 | 2 |

The five `erasableSyntaxOnly` errors are all parameter properties: `api/src/oidc/adapter.ts:133, 134` (`SqliteAdapter`), `shared-library/src/ward/errors.ts:53` (`WardSignInError`), `shared-library/src/testing/ward-harness.ts:287, 288`. `docs/` has its own `tsconfig.json` and was not measured.

**Typed and house rules**, one ESLint run over `api/src`, `ui/src`, `shared-library/src`, `shared-library/scripts` and `vitest.config.ts` with the rules below at `error` and `parserOptions.projectService`. 14.3 s cold for all of it, 2.5 s for one file. A split of source, tests (`*.test.ts`) and `shared-library/src/testing/ward-harness.ts` (the harness), with `noUncheckedIndexedAccess` on:

| Rule | Source | Tests | Harness |
|---|---|---|---|
| `no-floating-promises` | 0 | 0 | 0 |
| `no-misused-promises` | 0 | 0 | 0 |
| `await-thenable` | 0 | 1 (`api/src/routes/auth.test.ts:1028`) | 0 |
| `switch-exhaustiveness-check` | 3 (`ui/src/pages/Account.tsx:73`, `Login.tsx:71`, `Register.tsx:67`) | 0 | 0 |
| `consistent-type-imports` | 0 | 71 in 13 files (autofixable) | 0 |
| `no-unnecessary-type-assertion` | 4 (`api/src/oidc/adapter.ts:179`, `api/src/tokens/keys.ts:239`, `api/src/tokens/verify.ts:143`, `ui/src/console-api.ts:459`) | 16 | 0 |
| `@typescript-eslint/no-non-null-assertion` | **32** | **351** | **9** |
| `no-console` | 5 (`api/src/config.ts:341`, `api/src/oidc/client-keygen.ts:60, 64`, `api/src/tokens/keys.ts:302, 382`) | 3 (`api/src/integration/estate.test.ts:554-556`) | 0 |
| `no-process-env` | 3 (`api/src/config.ts:329`, `shared-library/src/fastify/plugin.ts:666`, `shared-library/src/ward/client.ts:548`) | 214 | 12 |
| `no-restricted-syntax` on `TSEnumDeclaration`, `no-warning-comments` | 0 | 0 | 0 |

Two things in that table matter:

- **The order matters for `no-unnecessary-type-assertion`.** Without `noUncheckedIndexedAccess` it finds 10 in source and 117 in tests, nearly all `!` on indexed access (`roles[0]!`, `bracketed[1]!`). With the flag on, the `!` is needed and the count drops to the 4 and 16 above. Turn the flag on first.
- **`no-non-null-assertion` finds 392, not Almanac's 9.** That is far past brief 27's "about 20" line, so it goes back to the owner (decision 6). Almanac's counts must not be assumed here.

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

**Not measured:** the test suite (no native build), `npx knip`, `docs/` (its dependencies are not installed), and `check`'s full run time. `typecheck` over the three workspaces takes 8.8 s cold, so `check:fast` should land near 12 s. Step 1 measures the rest.

## Owner decisions (defaults this brief builds)

1. **Where the configs come from** (skills library Q6). Default: the `house-style` package, extended from ward-auth's configs, **as a tarball URL**, not `github:`. The Docker image has no `git` (see above); a tarball needs none. If the owner prefers `github:`, add `git` to both `apk add` lines in the same commit. If Q6 goes the other way (copied files), the same rules land as local files with a version header, and steps 3-5 don't change.
2. **Width** (Q8). Default: **keep 100.** It is what the code is written in, and the estate's candidate widths cost 2,312 and 2,793 lines. If Q8 picks another width the reformat is its own commit with a blame-ignore entry, and these numbers are its price. *New question for the grilling: ward-auth is the one measured repo already formatted at 100; does the estate width apply to it?*
3. **Markdown.** Default: only the root `README.md` stays under Prettier, as `fmt` does today through the `"*.md"` glob; `corpus/` and `docs/docs/` stay out, and `.prettierignore` says so. The corpus has its own lint.
4. **tsconfig** (Q11). Default: add `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly` (0, 0 and 5 errors), not `exactOptionalPropertyTypes` (24 errors). *New question: `noUncheckedIndexedAccess` is on the house list and absent here; it costs nothing, so default is yes.*
5. **Typed lint** (Q12). Default: the six rules through `projectService`. This honours the config header's "compiler first" rule: all six see what the compiler cannot (a floating promise, a non-exhaustive switch, an import that only erases).
6. **The house shapes as errors** (Q13). Default: all errors, **except** `no-non-null-assertion`, which starts as a **warning** because it finds 392. Fixing 351 test sites is a rewrite of the tests' setup, not a formatting step. *New question: error in source (41 sites, fixed here), warning in tests, or error everywhere with a test helper that replaces the `!`?* `no-process-env` is an error from the start for `api/src` (its one source hit is `config.ts`, which is excepted) and brief 06 owns the exception for `shared-library` (decision 5 there).
7. **`check:fast`** (Q10). Default: a typecheck plus ESLint on the files changed against `HEAD` and the untracked ones, under about 15 s warm with one changed file.
8. **The Claude Code layer** (Q7). Default: the plugin's hooks. If the owner chooses committed hooks, add them to `.claude/settings.json` here.
9. **A root `CLAUDE.md`** (Q46). Default: create one, and move the repo-wide parts of `corpus/CLAUDE.md` out of it: only the brief-board section is repo-wide today.
10. **A version bump for the library.** `shared-library/src/ward/errors.ts:53` is inside the built bundle apps vendor. Changing the parameter property to a declared field assigned in the constructor does not change the API, but it changes the built file. Default: a patch bump to 0.7.1 and a `CHANGELOG.md` entry that says "no change for apps". *New question: does a no-behaviour change to the bundle's source need a version at all?*

## Files you OWN

- `tsconfig.base.json`.
- `eslint.config.js`, keeping its header and adding the new rules in the same style.
- `.prettierrc.json` (only if decision 2 changes the width), new `.prettierignore` and `.git-blame-ignore-revs`.
- The root `package.json` (scripts, devDependencies) and `package-lock.json`.
- The reformat and the fixes the new rules ask for:
  - `api/src/oidc/adapter.ts:133-134`, `shared-library/src/ward/errors.ts:53`, `shared-library/src/testing/ward-harness.ts:287-288` (the parameter properties);
  - the 3 `switch` sites in `ui/src/pages/`, the 4 source and 16 test unnecessary assertions, the `await-thenable` site, the 71 `import type` sites, the 3 `@ts-expect-error` descriptions;
  - the 41 source and harness `!` (decision 6);
  - `api/src/config.ts:341`, `api/src/oidc/client-keygen.ts:60, 64` and `api/src/tokens/keys.ts:302, 382`, only to record them as CLI or pre-logger output in the config's override, not to change them.
- `shared-library/scripts/vendor.test.ts` and `shared-library/scripts/vendor.mjs` (whichever holds the stale README wording).
- `shared-library/package.json` version and `shared-library/CHANGELOG.md` (decision 10).
- New: `.claude/rules/ui.md`, `.claude/rules/api.md`, `.claude/rules/shared-library.md`, root `CLAUDE.md`, `scripts/check-fast.mjs` if the package ships none, and `scripts/conventions.json` if an exception is needed.
- [CLAUDE.md](../../CLAUDE.md): its brief-board section moves out.
- Corpus: [wiki/decisions-implementation.md](../../wiki/decisions-implementation.md) (a new entry), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- Behaviour. Apart from the fixes above, every change is formatting or configuration.
- `api/src/config.ts`'s reading of the environment (brief 06).
- The CSS and the class names (briefs 04 and 05) and the layout of `api/src` (06).
- `docs/`. Its Docusaurus scripts and CSS are out of the harness's scope; record any `docs/` file the new globs would reach in the outcome note.
- The skills library and the `house-style` repo. A rule that seems wrong for ward-auth is reported back, not patched here.

## What to do

One commit per step, each with `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` green.

1. **Measure and unblock.**
   - Fix the failing `shared-library/scripts/vendor.test.ts` (it expects the old README wording), so the gate starts green.
   - Run the test suite, `npx knip` from the `house-style` preset, and `@vitest/eslint-plugin` recommended with `assertFunctionNames: ["expect", "expectError"]` (check what helper the tests use first: `grep -rn "function expect" api/src ui/src shared-library/src`).
   - Re-run the typed-rule table above on the real tree and time `check:fast`'s two halves.
   - Record every number in the `log.md` entry. A rule that finds more than about 20 real problems, or mostly false ones, goes back to the owner before it is turned on: `no-non-null-assertion` is already one.
2. **Widen the existing gates before adding anything.** Make `fmt`, `fmt:check` and `lint` cover the files today's globs miss: root configs, `ui/vite.config.ts`, `infrastructure/local/seed.mjs`, `shared-library/scripts/vendor.test.ts`. Replace the per-glob lists with `prettier --check .` and a `.prettierignore` (`dist/`, `node_modules/`, `shared-library/.scratch/`, `package-lock.json`, `corpus/`, `docs/`), and run `eslint .`. **Check that each file the old globs missed is now reached**, with a deliberate mis-format in `ui/vite.config.ts`: the repo has been bitten by a gate that covered less than it looked ([wiki/decisions-implementation.md](../../wiki/decisions-implementation.md)).
3. **Prettier.** Pin the 3.9.6 already in the lockfile, apply decision 2, and run `npm run fmt`. Expect about 30 lines in 7 files at width 100, none of them behaviour. Commit that alone as `style: format with Prettier`. Add its full hash to `.git-blame-ignore-revs` in its own commit, and hand the owner `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
4. **tsconfig.** Add the three flags from decision 4 to `tsconfig.base.json`, one commit.
   - Fix the five parameter properties: a declared field assigned in the constructor, same `readonly`, same behaviour. Run `api`'s `SqliteAdapter` tests and the library's tests after.
   - Bump the library per decision 10 in this commit's neighbour, never the same commit as an unrelated change.
   - `npm run build` and `docker build -f infrastructure/Dockerfile .` must still pass.
5. **ESLint.** Extend the house config (decision 1) and add, in the config's own style (one comment saying why each rule is there):
   - the six typed rules, `projectService` with `allowDefaultProject` for `vitest.config.ts` and `eslint.config.js`, and `disableTypeChecked` for `shared-library/scripts/*.mjs` and `infrastructure/local/seed.mjs`;
   - `no-restricted-syntax` on `TSEnumDeclaration`, `no-warning-comments` (`todo`, `fixme`, pointing at `corpus/todos/`), `no-console` outside the three CLI and pre-logger sites in the table, `no-default-export` outside `*.config.*`;
   - `no-process-env` for `api/src` outside `config.ts` and tests, and `no-non-null-assertion` per decision 6;
   - `@vitest/eslint-plugin` recommended on `*.test.{ts,tsx}`;
   - `ban-ts-comment` allowing `@ts-expect-error` only with a description.

   Fix what the rules find in source; list each finding left, with its reason, in the outcome note. `react-hooks` and `no-explicit-any` stay as they are.
6. **The gate.** In the root `package.json`:
   - `check` runs `typecheck`, `lint`, `format:check` (renamed from `fmt:check` only if the owner agrees; otherwise keep the name), `check:conventions` and `test`;
   - `check:conventions` is knip plus the two checkers from the `house-style` package; `check-base-ui` runs `--warn-only` until brief 05 is done and `check-structure` until brief 06 is done;
   - `check:fast` runs the typecheck, then ESLint on the files changed against `HEAD` plus untracked ones. No shell-only syntax: the owner works on Windows under WSL.

   Time `check:fast` warm with one changed file, and `check` in full, and record both.
7. **`.claude/rules/`**, each under about 40 lines, with `paths:` frontmatter:
   - **`ui.md`** (`ui/src/**`): Base UI only in the console and only through its wrappers (brief 04); the sign-in pages import none; the `data-wc-focus` rule after a write; light only; `console.css` and `ward.css` are replaced in brief 05, which adds the Tailwind lines.
   - **`api.md`** (`api/src/**`): `config.ts` is the only reader of the environment; the lazy `await import("../config.js")` is deliberate (18 sites; `buildApp` must not touch the database or the config before `index.ts` has migrated); failures keep the repo's error bodies; a malformed body is not a lockout failure; the lockout key is never `request.ip`; the OIDC provider is mounted through `oidc/routes.ts` and nothing else; tests drive `buildApp()` over `inject()`. Brief 06 adds the structure lines.
   - **`shared-library.md`** (`shared-library/src/**`): apps vendor this, so an API change needs a version, a `CHANGELOG.md` entry with an upgrade note, and `npm run vendor` is how it ships; no Fastify or React import in `core/`; no `process.env` outside the two documented fallbacks.
8. **`CLAUDE.md`** at the root, under about 60 lines: one line on what Ward is; "read `corpus/index.md` first"; the commands (`npm run dev`, `npm run check` before every hand-back, `npm run check:fast`, `npx vitest run <file>`, `npm run keygen`, `npm run vendor`); the places that mislead (the API on 8791 and the UI on 5174, `ui` is not in the Docker image, `docs` is a workspace without `"type": "module"`, the `shared-library` bundle is what apps copy); the moved brief-board section. [CLAUDE.md](../../CLAUDE.md) keeps the numbering note and the code-comment rule.
9. **Corpus.** Add the entry "The house style, formatted and checked" to [wiki/decisions-implementation.md](../../wiki/decisions-implementation.md) (width, config source, the compiler-first rule kept, what was rejected: `recommendedTypeChecked` as a whole, `exactOptionalPropertyTypes`, Markdown under Prettier), update [wiki/status.md](../../wiki/status.md) and [log.md](../../log.md), and run `bash corpus/lint.sh` until it is clean.

## Acceptance

- [ ] `npm run check` passes, and its time and `check:fast`'s (warm, one changed file) are in the outcome note. `check:fast` is under about 15 s, or the owner accepted the time.
- [ ] `npx prettier --check .` passes, and the reformat commit changes whitespace only (`git diff -w <hash>^ <hash>` shows nothing outside it); its hash is in `.git-blame-ignore-revs`.
- [ ] `tsconfig.base.json` has `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`; `npm run typecheck` and `docker build -f infrastructure/Dockerfile .` pass.
- [ ] A deliberate mis-format in `ui/vite.config.ts`, an `enum`, a `console.log` in `api/src/app.ts`, a `// TODO` and an `export default` in `api/src/app.ts` each fail `npm run check`. Revert them after.
- [ ] `npm run lint` reports zero errors, with the table's counts before and after in the outcome note and every finding left listed with its reason.
- [ ] `grep -n "apk add" infrastructure/Dockerfile` shows `git` on both lines only if decision 1 chose `github:`.
- [ ] `.claude/rules/ui.md`, `api.md` and `shared-library.md` exist with `paths:` frontmatter, and the root `CLAUDE.md` lists `npm run check` and is under about 60 lines.
- [ ] With the plugin's hooks on, an agent's edit is formatted on save, and a type error stops it at `Stop`.
- [ ] `bash corpus/lint.sh` ends clean.

## Interplay

- **Brief 04** adds nothing to the gate. **Brief 05** adds `better-tailwindcss` and drops `check-base-ui`'s `--warn-only`; its `fmt` glob loses `ui/src/**/*.css` except `ui/src/styles/index.css`. **Brief 06** drops `check-structure`'s `--warn-only`, adds dependency-cruiser and records the `shared-library` `process.env` exceptions.
- The skills library's brief 25 (the security audit, aimed at ward-auth) reads the same tree. Its findings land after this reformat, so the audit sees formatted code and a typed lint; this brief changes no behaviour for it to re-run against, apart from the five parameter properties.
- The reformat touches files every later brief rewrites. Run it when no other brief has uncommitted work.
