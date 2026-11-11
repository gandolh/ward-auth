# Brief 06 — The server in the house code structure

**Depends on:**

- In ward-auth: brief 03, for the gate, `no-process-env` and `.claude/rules/api.md`.
- In the owner's skills library:
  - brief 03, *A code-structure skill for the Fastify + React apps*: rules 1-11, the `server-skeleton.md` and `zod-type-provider.md` references, `migrating-a-server.md`, `check-structure.mjs`, and the dependency-cruiser and knip presets;
  - brief 16, *The Fastify servers adopt the code structure*: ward-auth's row and the method;
  - brief 15, *Enforce the base-ui and code-structure skills in every repo*: `check-structure` runs `--warn-only` until this brief is done.
- The owner's grilling of 2026-11-10: Q1 (how the service starts), Q23 (`features/`), Q24 (plugin options, explicit registration), Q25 and Q53 (response schemas, and their exemptions), Q27 (the test runner), Q43 (one error handler), Q55 and Q56 (where schemas live, no decorators as a test seam). All decided or kept as defaults; see Owner decisions.

**Order:** after 03. It touches no file that 04 or 05 touch, so it may run before them, but never at the same time as either.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

The owner asked on 2026-11-09 for one researched code structure, enforced in every repo. ward-auth's server is further from it than Almanac's in layout and closer in schemas. **Ward is the OIDC provider every app signs in through, so no route, cookie or token format changes in this brief**: the paths, the status codes, the `Set-Cookie` headers and the token claims stay byte-identical, and step 1's snapshot proves it:

- **Already there:** `buildApp()` never listens (`api/src/app.ts`, 182 lines, no `listen()`); `api/src/config.ts` is the one reader of the environment among the server's own files; five routes already declare a **response** schema, as a JSON-Schema filter whose stated purpose is that a leaked field cannot reach the client; 28 test files drive the real app over `inject()`, and 35 `buildApp(` calls sit outside `app.ts`.
- **Missing:** the `server.ts` name, `fastify-plugin` on the cross-cutting parts, feature folders, schemas on request input, and `close-with-grace` (the entry has a hand-written shutdown that closes the database for a documented reason).
- **Not what the skill assumes:** `buildApp()` takes no config; `config.ts` validates at import and exports constants; routes are registered as encapsulated plugins, and each admin module installs its own `preHandler` guard.

**Two things in this server are decisions, not accidents, and the brief protects them:**

- *a malformed body is not a failure to count.* `/login`, `/register` and `/refresh` return a terse 400 and spend no lockout budget, and the comments say zod's issue list echoes submitted values, one of which is a password (`api/src/routes/auth.ts:186-191`, `api/src/routes/register.ts:234-245`);
- *the lockout key is never `request.ip`* ([wiki/decisions-implementation.md](../../wiki/decisions-implementation.md), "The lockout is keyed on the forwarded address, never `request.ip`").

### The versions (verified 2026-11-10)

- **fastify 5.12.7** in `api/package.json` and `shared-library/package.json`; the latest is 5.12.8. **zod 4.5.4**, one copy in `package-lock.json`, so **no zod move**.
- **`@fastify/type-provider-zod` 1.0.3** needs `zod >=4.2.0` and `fastify ^5.5.0`, and declares `@fastify/swagger >=9.5.1` and `openapi-types ^12.1.3` as required peers, so npm installs both. `fastify-plugin` 6.0.1 and `close-with-grace` 2.5.0 are the other new dependencies. All pinned exactly.
- **The image has no `git`** (`infrastructure/Dockerfile:29, 50`: `apk add --no-cache python3 make g++`), and `npm ci` runs in two stages. Every dependency here is an npm registry package, so nothing needs git. Q1 (a fact, 2026-11-10): the container starts a file path and the build runs only `npm ci` and `npx tsc -b`, no tests or lint.
- **Fastify 5.12.7's defaults**, read from `node_modules/fastify/lib/config-validator.js`: `connectionTimeout` 0, `keepAliveTimeout` 72,000 ms, `requestTimeout` 0, `handlerTimeout` 0.

### Traps found 2026-11-10

1. **No zod `.transform()` reaches a response.** Every response schema is plain JSON Schema, and the zod schemas with a transform (`api/src/config.ts:76, 138, 251`, and `.pipe(z.email())` at `api/src/routes/register.ts:157`) are the environment and one request body. The provider's serializer throws on a transform *when encoding*, and none is on that path. The trap that hit Almanac does not apply, but the five existing response schemas **must be rewritten as zod**: the provider's serializer compiler does not accept a JSON-Schema object.
2. **A response schema may declare only statuses its handler sends itself.** A status declared for a reply that a guard or a hook sends turns into a 500. Today the 401s from `requireConsoleSession` (`api/src/auth/console-guard.ts`) are sent by the guard, so no admin route may declare 401. The five existing ones are fine: `api/src/routes/notify.ts` sends its own 401 (lines 354, 369) and 503 (441), and `api/src/routes/session-status.ts` its own 401 (201); `session.ts`, `account.ts` and `public-apps.ts` declare 200 only. Step 1 lists each route's handler-sent statuses.
3. **The type provider's validation would change behaviour on 11 routes.** There are **35** request-input `safeParse` calls (`grep -rn "safeParse(request\.\|safeParse(withoutCredentials" api/src`, tests excluded). In **24** the failure branch is `return reply.code(400).send({ error: "invalid_request" })` and nothing else (checked by reading the nine lines after each). The other **11** do something different, and a provider-level 400 would silently replace it:

   | Site | What the failure does today |
   |---|---|
   | `api/src/routes/session-status.ts:185` | a malformed credential body is a 401 `invalid_client` |
   | `api/src/routes/session-status.ts:204` | a malformed body returns `{ active: false }` with a 200 and a log line: fails closed to "inactive", never a 400 |
   | `api/src/routes/notify.ts:413` | `refuse("invalid_body")`, which also counts against the notify limiter |
   | `api/src/routes/auth.ts:186, 349, 489` | a terse 400 that **must not** spend lockout budget |
   | `api/src/routes/register.ts:234` | the same carve-out, for the registration budget |
   | `api/src/routes/register.ts:513` | the verify page's query: a rendered page, not JSON |
   | `api/src/routes/console.ts:211` | writes an audit row (`console.login.failed`, reason `malformed`) before answering |
   | `api/src/routes/account.ts:276` | a terse 400 that must not spend lockout budget (the gate was consulted just before) |
   | `api/src/oidc/interaction.ts:67` | renders the "expired" page |

   So request schemas are **not** a mechanical swap here. See decision 2.
4. **Timeouts.** There are no long polls: the only periodic call is `POST /session-status` every 30 seconds, and the OIDC provider answers redirects. What is slow is mail: `api/src/routes/register.ts:573` and `api/src/routes/notify.ts:431` await `sendMail`, and `api/src/mail/transport.ts` sets no timeout of its own, so nodemailer's defaults apply (connection 2 min, greeting 30 s, socket 10 min). A Fastify `connectionTimeout` or `requestTimeout` shorter than that cuts the reply to a registration whose mail is slow. **The slow SMTP keeps its timeout:** Ward sets no `connectionTimeout` and no `requestTimeout` (decision 5).
5. **`trustProxy` conflicts with a recorded decision.** The lockout reads the socket and the last `x-forwarded-for` element itself and "is never `request.ip`". Setting `trustProxy` changes `request.ip` in logs only, but the decision is about *not depending on it*. See decision 6.

### The move map: `api/src/` (114 files: 64 source in 15,042 lines, 50 tests in 15,842)

A bare name sits at the root of `api/src/`.

Today the layout is the layer-split the skill moves away from, though only in part:

- **`db/`** is the shared base. Measured on 2026-11-10 with a one-off import scan over non-test files, cross-folder imports are: `routes → db` 40, `routes → auth` 22, `oidc → db` 13, `auth → db` 6, `grants → db` 5, `routes → audit.ts` 4, `routes → oidc` 4, `routes → mail` 4, `routes → tokens` 3, `routes → grants` 3. Five domain folders (`auth/`, `grants/`, `mail/`, `oidc/`, `tokens/`) form a one-way graph under `routes/`, and none imports `routes/`. The root files import `routes/` 15 times (`app.ts`).
- **`routes/`** (16 files with `admin/`, 5,133 lines) holds one file per endpoint family, 44 route registrations.

The default map keeps what is already a domain module and moves what is a layer. It is a proposal, because the skill has no place for a domain folder that is neither a plugin nor a feature (decision 1):

| Today | Lines | Target | Note |
|---|---|---|---|
| `index.ts` | 77 | `server.ts` | Config → migrate → `buildApp` → `listen` → shutdown. The hand-written shutdown becomes `close-with-grace` with the same two jobs: `app.close()`, then `closeDb()` ([wiki/decisions-implementation.md](../../wiki/decisions-implementation.md), "The database handle is closed on shutdown"). |
| `app.ts`, `app.test.ts` | 182 | the same | `buildApp()` stays argument-free; it gains one optional `{ server }` parameter for the Fastify options. The inline error handler (lines 34-48) moves to `plugins/errors.ts`. |
| `config.ts`, `config.test.ts` | 432 | the same | Unchanged in shape: see decision 3. |
| `audit.ts` | 138 | `lib/` or stays | Imported by four route files and `grants/`; step 1 checks it has no Fastify import. |
| `routes/health.ts` | 14 | `features/health/routes.ts` | |
| `routes/jwks.ts` | 66 | `features/jwks/routes.ts` | |
| `routes/session.ts`, `session-status.ts` | 96, 227 | `features/session/` | the two session checks; both already carry schemas |
| `routes/auth.ts` (+ test, 1,286 lines) | 685 | `features/auth/routes.ts` | `/login`, `/refresh`, `/logout`, `/refresh/logout` |
| `routes/register.ts` | 803 | `features/register/routes.ts` | over rule 11's 400 lines: a warning to leave |
| `routes/account.ts`, `public-apps.ts`, `notify.ts` | 562, 105, 448 | `features/account/`, `features/public-apps/`, `features/notify/` | |
| `routes/console.ts` | 324 | `features/console/routes.ts` | login, logout, session; carries its own `onRequest` hook (line 170) |
| `routes/admin/{accounts,apps,audit,grants,sessions,support}.ts` | 496, 438, 167, 209, 303, 190 | `features/admin/` (same names) | each installs `requireConsoleSession` as an encapsulated `preHandler`; not `fastify-plugin` wrapped, so the hook stays inside |
| `oidc/routes.ts`, `interaction.ts` and the rest of `oidc/` | 195, 250, … | **unchanged** | the provider's mount (`oidc/routes.ts:117-130`, `reply.hijack()`) stays as it is; no schema is applied to it |
| `auth/`, `db/`, `grants/`, `mail/`, `tokens/` | 8, 9, 2, 2, 7 files | **unchanged**, see decision 1 | domain modules, not features |
| `integration/estate.test.ts`, `db/test-support.ts` | | the same | |

Every moved file's relative imports change, **and the 18 lazy `await import("../config.js")` sites** (`grep -rn 'import("\.\./config.js")' api/src`) change with their folder depth: they are deliberate (`api/src/routes/auth.ts:155-162` explains, for the database, why `buildApp` must not reach it before `index.ts` has migrated), so the lazy form stays and only the path moves.

### Every reader of the environment

| Where | What | Afterwards |
|---|---|---|
| `api/src/config.ts:329` | `mailAwareSchema.safeParse(process.env)` | stays: the one reader |
| `shared-library/src/fastify/plugin.ts:666` | `AUTH_TRUSTED_PROXIES`, only when the `trustedProxies` option is absent | stays; a recorded exception for `no-process-env` |
| `shared-library/src/ward/client.ts:548` | a fallback read | stays; the same exception |
| `shared-library/src/testing/ward-harness.ts:126-` (12) | test support | excepted as tests |
| tests | 214 reads | excepted |

No file in `api/src` reads `NODE_ENV` (the four hits are comments saying there is no such branch). `api/src` is already compliant with rule 3, so this brief only turns `no-process-env` from brief 03's setting into an error with `config.ts` excepted.

### Every route: 44 registrations by file (a grep; step 1 recounts with an `onRoute` hook)

| File | Count | Schema today |
|---|---|---|
| `api/src/routes/admin/accounts.ts` | 8 | none |
| `api/src/routes/admin/apps.ts` | 6 | none |
| `api/src/routes/auth.ts` | 4 | none |
| `api/src/routes/admin/{grants,sessions}.ts` | 3, 3 | none |
| `api/src/routes/account.ts` | 3 | `GET /account` response 200 (`ACCOUNT_RESPONSE_SCHEMA`, line 136) |
| `api/src/routes/console.ts` | 3 | none |
| `api/src/oidc/interaction.ts` | 3 | none; renders pages |
| `api/src/routes/register.ts`, `api/src/oidc/routes.ts` | 2, 2 | none; the second pair is the raw-handoff mount |
| `api/src/routes/admin/audit.ts`, `health.ts`, `jwks.ts`, `public-apps.ts`, `notify.ts`, `session.ts`, `session-status.ts` | 1 each | `public-apps` 200; `notify` 200/401/503; `session` 200; `session-status` 200/401 |

The five existing schemas are `SESSION_RESPONSE_SCHEMA` (`session.ts:53`), `ACCOUNT_RESPONSE_SCHEMA` (`account.ts:136`), `PUBLIC_APPS_RESPONSE_SCHEMA` (`public-apps.ts:64`), `NOTIFY_ROUTE_SCHEMA` (`notify.ts:299`) and `STATUS_ROUTE_SCHEMA` (`session-status.ts:112`). Each is a filter on purpose (`additionalProperties: false`), and `session.ts` exports its schema so a test can push an over-full object through it. The zod versions must keep both properties, and keep the test.

### The error handler

`app.ts:34-48` today: a 4xx Fastify raised becomes `{ statusCode, error: error.name, message }`; anything else is a 500 `{ error: "internal" }` logged. Routes themselves send `{ error: "<code>" }` (35 sites use `invalid_request`, 10 `invalid_refresh`, 10 `invalid_client`, 6 `invalid_credentials`). **Ward's shapes are kept as they are; no new envelope is imposed.** The plugin moves the same handler and adds only: a response-serialization error is a 500 `{ error: "internal" }`, logged with method and URL, never shown.

## Owner decisions

Decided on 2026-11-10 unless marked as a default.

1. **Where the domain folders go** (Q23, decided 2026-11-10, technical call for `features/`; the domain-module split is a default). `features/<name>/` holds only what was in `routes/` (one folder per route file, `admin` as one); `auth/`, `db/`, `grants/`, `mail/`, `tokens/` and `oidc/` stay where they are as domain modules, because `db/` has 67 incoming cross-folder imports and the others sit under the routes in a one-way graph. The checker's rule 5 (features import each other only through `index.ts`) then governs the `features/` side, and dependency-cruiser is configured so features may import the domain modules freely and the domain modules may not import `features/`. Q59 and the checkers read the repo's roots from `conventions.json` (here `api/src`). *Still open for the skills library: does the skill's tree have a place for domain modules that are neither plugins nor features, or should they fold into features with `index.ts` barrels (which breaks rule 5 unless stores move into features)?*
2. **Request schemas** (Q25, decided 2026-11-10, technical call, with Q53's exemption mechanism). **Response schemas everywhere** (rule 6), and request schemas through the provider only on the **24** routes whose failure is exactly `400 { error: "invalid_request" }`, with the error plugin mapping any validation error to that body and dropping the issue list. The **11** sites in trap 3 keep their hand `safeParse`, each with a comment saying why it is excepted, listed in `scripts/conventions.json` the way Q53 lists a stream or binary route. A route whose malformed body has a side effect is a recorded per-route exception, not a design this brief invents. Where a schema lives follows Q55: in `shared/` when the client imports it (here, `shared-library`), otherwise in its feature folder; the response schemas are server-only and live beside their routes.
3. **Config shape** (default). Keep `config.ts` as the import-time validated module with its lazy imports, and do **not** convert it to a `loadConfig()` factory. It is already the only reader, and converting it would touch 33 files that import it and 214 test reads, to gain what rule 3 already gets. Config read at import time is allowed (the technical calls page).
4. **The entry file** (Q1, decided 2026-11-10, fact). Rename `index.ts` to `server.ts` and change, in the same commit: `infrastructure/Dockerfile:114` (`CMD ["node", "api/dist/index.js"]`), `infrastructure/local/compose.yaml:23` (`exec node api/dist/index.js`), `api/package.json:8` (`dev`), the comment at `.gitignore:18` and `docs/images/shots.md:19`. `api/package.json` has no `main` or `exports` to change. Every service runs in a container started by the Dockerfile's `CMD`, so the deploy needs no other edit and no owner step for the start command.
5. **Timeouts** (technical call). Set `keepAliveTimeout: 125_000` only, above Caddy's two-minute idle keep-alive to its upstream, so the API never closes a connection Caddy is about to reuse; leave `connectionTimeout`, `requestTimeout` and `handlerTimeout` at Fastify's 0, **because mail can be slow and the transport sets no limit**: the slow SMTP keeps its timeout. Giving the mail transport its own timeouts would be a behaviour change in `api/src/mail/transport.ts` and is not made here. Check the deploy's Caddy snippet for its own `keepalive` first. The skills library's brief should state that `connectionTimeout` must exceed the longest idle response.
6. **`trustProxy`** (default). **Not set**, and recorded: Ward's lockout and its decision are written around the socket and the forwarded header, and `request.ip` is not used for any decision. Logs keep showing the proxy's loopback address.
7. **The test runner** (Q27, decided 2026-11-10, technical call). vitest stays; `inject()` against the real `buildApp` is a recorded decision ([wiki/decisions-implementation.md](../../wiki/decisions-implementation.md), "Integration tests drive the real `buildApp`").
8. **The test helper and decorators** (Q56, decided 2026-11-10, technical call). No decorator is added as a test seam: tests pass dependencies as plugin options. Keep `api/src/db/test-support.ts` and the tests' own `buildApp()` calls; record the missing `buildTestApp` name in `scripts/conventions.json` if the checker looks for it.
9. **The error body** (Q43, decided 2026-11-10, technical call). One error handler, keeping Ward's shapes (`{ error: "<code>" }` from the routes, the Fastify 4xx shape from the handler); it passes Fastify's own 4xx through and never echoes a thrown message to the client. No envelope is imposed.
10. **Library impact** (default). None. `shared-library` is a Fastify plugin and a React client that other apps vendor; this brief changes the server's responses only by stripping fields the schemas do not name, so step 1's snapshot must cover every field **any vendored version** reads (0.7.0, 0.4.0, 0.3.1 per [wiki/status.md](../../wiki/status.md)): `active`, `role`, `subject`, `username`, `grants` from the session checks, and the `/account` fields. If a field a vendored version reads is missing from a schema, that is a schema bug, fixed in the schema.
11. **Fastify 5.12.8 and logging** (default). The 5.12.8 bump is not in this brief; JSON logs as today (`logger: true`), no `pino-pretty`.
12. **No PRs, no branches** (Q4, decided 2026-11-10, owner). One commit per step, straight on `main`.

## Files you OWN

- `api/src/**`: the moves, the new plugin, the schemas wired in, the entry rename.
- `api/package.json` (the new dependencies pinned, the `dev` script) and `package-lock.json`.
- `infrastructure/Dockerfile` (the `CMD` line) and `infrastructure/local/compose.yaml` (line 23).
- The root `package.json`: `check:conventions` gains dependency-cruiser, loses `check-structure`'s `--warn-only`. *(2026-11-11, brief 03: dependency-cruiser is already in `check:conventions`, over `api/src`, `ui/src` and `shared-library/src`.)*
- `.dependency-cruiser.cjs` (new, from the skill's preset). *(2026-11-11, brief 03: it exists, extending the vendored house preset, with `no-circular` lowered to a dated warning for its one finding, the type-only cycle between `shared-library/src/fastify/plugin.ts` and `fastify/ward.ts`. This brief keeps adding the features-against-domain-modules rules and the deliberate cross-feature check, and raises `no-circular` back to an error once that cycle is gone.)*
- `eslint.config.js`: `no-process-env` to error.
- `scripts/conventions.json`, for the 11 excepted parse sites, the `shared-library` environment reads, and any entry-file or helper-name exception.
- `.claude/rules/api.md`: the structure lines.
- `.gitignore:18` (a comment), `docs/images/shots.md:19`, and the docs pages that name `api/src/routes/` or `api/src/auth/` (find them with `grep -rn "api/src/" docs/docs corpus/wiki`).
- Corpus: [wiki/decisions-implementation.md](../../wiki/decisions-implementation.md) (the entry), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- `ui/` and `shared-library/` (the library's one `process.env` read stays and is excepted).
- **Routes, cookies and token formats.** Paths, methods, status codes, `Set-Cookie` headers and token claims stay byte-identical; every app signs in through Ward.
- `api/src/oidc/` beyond its import paths: `oidc-provider`'s mount is kept as it is.
- Behaviour: status codes, error codes and bodies, the lockout and its key, the audit rows, and every route's JSON apart from fields the comparison shows were leaks.
- The migrations under `api/src/db/migrations/` beyond their folder-relative imports.

## What to do

One commit per step, straight on `main`; after each, `npm run check` and `npm run build` pass, and `node api/dist/server.js` (or `index.js` before step 3) answers `GET /health`.

1. **Before.**
   - Run `check-structure` strict and record its counts by rule.
   - Record each route's method, path, handler-sent statuses and, for the 35 parse sites, which of the 24 and the 11 it is, reading each failure branch.
   - Start a scratch API with a scratch database and key, sign in as an ordinary account and as the superuser, and save the JSON of every route in the table with fixed inputs, including the status and `Set-Cookie` headers of every error path that trap 3 names.
2. **The dependencies and the error plugin.** Add `@fastify/type-provider-zod`, `@fastify/swagger`, `openapi-types`, `fastify-plugin` and `close-with-grace`, pinned. Move `app.ts:34-48` to `api/src/plugins/errors.ts`, wrapped in `fastify-plugin` and registered first, unchanged in behaviour, with the serialization-error case added. Every test passes unchanged.
3. **`server.ts`.** Rename the entry (decision 4), swap the shutdown for `close-with-grace` keeping the order (`app.close()`, then `closeDb()`, then exit), pass `{ server: { keepAliveTimeout } }` through `buildApp` (decision 5: no other timeout is set). Test the shutdown: SIGTERM leaves `ward.db` with its tables, the check the decision names.
4. **The type provider and the response schemas, one feature per commit.** Set the validator and serializer compilers in `buildApp`. For each of the five existing schemas, rewrite it as zod keeping the filter property (a test pushes an over-full object through it and asserts the extra fields are gone), and declare only handler-sent statuses (trap 2). Then add response schemas to the remaining routes with a JSON reply, one commit per route file.
5. **Request schemas on the 24 plain routes**, one file per commit, each removing that file's `safeParse(request.…)` and mapping a validation error to `400 { error: "invalid_request" }` with no issue list. Add a test per file that a malformed body returns exactly the old body and that `/login`-style routes spend no lockout budget. The 11 sites stay, each with a comment.
6. **Feature folders** (decision 1). `git mv` file by file per the map, update imports and the 18 lazy config paths, add `index.ts` only where another feature needs a surface. Add `.dependency-cruiser.cjs` and check that a deliberate import of one feature's internals from another fails it, and that a domain module importing `features/` fails it.
7. **After.** Save the step 1 JSON again and diff it. A field that disappeared is a leak (keep it dropped and list it) or a missing schema field (add it). Put the summary in the `log.md` entry.
8. **Strict.** Drop `check-structure`'s `--warn-only`, make dependency-cruiser part of `check:conventions`, turn `no-process-env` into an error.
9. **Corpus.** Add an entry adopting the structure (what was rejected: the skill's layout without domain modules, request schemas on every route, an imposed error envelope, `trustProxy`; why), update the pages under Files you OWN, and run `bash corpus/lint.sh` until it is clean.

## Acceptance

- [ ] `check-structure` passes **strict**, with each exception in `scripts/conventions.json` and its reason; its counts before and after are in the outcome note for the skills library's brief 16 table.
- [ ] `grep -rn "safeParse(request\.\|safeParse(withoutCredentials" api/src --include=*.ts` (tests excluded) prints exactly the 11 excepted sites, each with a comment.
- [ ] `grep -rn "process\.env" api/src --include=*.ts | grep -v "\.test\.ts"` prints only `config.ts` (and comments), and `no-process-env` is an error.
- [ ] Every route that returns JSON has a `response` schema declaring only statuses its handler sends; a test per route file fails if a guard-sent status is declared.
- [ ] The five filters still strip fields: the `session.ts` over-full-object test passes, and one equivalent exists for each of the other four.
- [ ] The malformed-body behaviour of the 11 excepted routes is byte-identical before and after, and `/login`, `/register` and `/refresh` spend no lockout budget on one (a test each).
- [ ] The before and after JSON comparison is in `log.md`, with every dropped field named and checked against what each vendored version of the library reads.
- [ ] `npm run build` writes `api/dist/server.js`; `docker build -f infrastructure/Dockerfile .` succeeds and the container answers its health check. No vps-deploy change is needed (decision 4).
- [ ] The before and after snapshots show the same paths, status codes, `Set-Cookie` headers and token claims for every route: no route, cookie or token format changed.
- [ ] A SIGTERM leaves the database checkpointed (`ward.db` holds its tables, no `-wal` data pending).
- [ ] dependency-cruiser fails on a deliberate cross-feature import and passes clean.
- [ ] `npm run check` passes, and `bash corpus/lint.sh` ends clean.

## Interplay

- Brief 03 sets `no-process-env` as a warning for `api/src`; the only source hit there is `config.ts`, so this brief only has to except it and make it an error. *(2026-11-11, brief 03: `n/no-process-env` is already an error in `api/src`, with `config.ts` excepted by the house config. The warnings left are in `eslint.config.js`'s `ward/library-process-env-warns` block: `shared-library/src/fastify/plugin.ts`, `ward/client.ts` and the test harness's 12 writes; `check-structure` rule 3 counts the first two. Brief 03 also left `knip.config.js` ignoring the unused `api/src/tokens/index.ts` barrel, for this brief's layout to use or delete.)*
- The skills library's brief 25 (the security audit) runs on ward-auth first, by the owner's answer of 2026-11-10 (Q34): one focused run of about an hour on the login, session and token code, and its findings become ward-auth briefs. It reads the very code decision 2 keeps hand-parsed. Run it before this brief's step 5, or after the whole brief, not between: its findings on the malformed-body paths would otherwise point at moved files.
- The skills library should hear about three things before the other servers run its brief 16: the zod provider rejects JSON-Schema response objects, a handler-sent status is the only one a schema may declare, and a repo may have parse sites whose failure has a side effect. All three apply beyond ward-auth.
