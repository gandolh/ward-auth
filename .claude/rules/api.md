---
paths:
  - "api/src/**"
---

# The API (`api/src`)

- Ward is the OIDC provider every app signs in through. A change to a route,
  a cookie, a token or an error body changes every app: say so before you
  make one.
- The layout follows the code-structure skill: `server.ts` is the entry and
  the only file that listens (`close-with-grace`, then `closeDb()`);
  `app.ts` builds the app (the zod compilers, the error plugin first, then
  each feature through its `index.ts`) and never listens; `config.ts` reads
  the environment.
- `features/<name>/` holds what was `routes/`: one folder per route file,
  `admin/` for the console's five plugins. `auth/`, `db/`, `grants/`,
  `mail/`, `oidc/` and `tokens/` are domain modules: a feature imports them
  freely, and they never import a feature (dependency-cruiser checks it).
  Another feature, and `app.ts`, use a feature through its `index.ts`.
- `plugins/errors.ts` is the one error handler, `fastify-plugin` wrapped and
  registered first. A failed request schema is `400 { error:
  "invalid_request" }` with no issue list; Fastify's own 4xx pass through as
  `{ statusCode, error, message }`; anything else, a reply its schema
  rejects included, is `500 { error: "internal" }` and never echoes a thrown
  message.
- Every route that answers JSON declares a zod `response` schema for each
  status its handler sends, and no other: the admin routes don't declare the
  console guard's 401 (`GET /console/session` declares its own as
  `errorReply`, which carries the guard's body through). Error statuses use
  `lib/replies.ts`'s `errorReply`, which also carries Fastify's own 4xx body
  through. Keys follow the order the handler
  builds them, so the bytes don't change.
- Request schemas go through the type provider. Eleven sites stay
  hand-parsed because their failure does something a 400 would replace
  (an audit row, the lockout gate first, a 401, a fail-closed 200, a counted
  refusal, a page); each says why, and each is an exception in
  `scripts/conventions.json`.
- The console guard runs in `preValidation`, so a signed-out caller's
  malformed request is a 401, not a 400.
- The lazy `await import("../../config.js")` (18 sites) is deliberate:
  `buildApp()` must not touch the database or the config before `server.ts`
  has migrated. Don't hoist them to static imports.
- A malformed body is a client bug, not a lockout failure: it gets a 400 and
  spends no lockout budget.
- The lockout key comes from `lockoutKeyFor` (`auth/lockout.ts`), which
  applies `WARD_TRUSTED_PROXIES` to the forwarded address; never from
  `request.ip`. `trustProxy` stays unset.
- `server.ts` sets `keepAliveTimeout` (125 s) and nothing else: no
  `connectionTimeout` or `requestTimeout`, because the mail transport sets no
  limit of its own.
- The OIDC provider is mounted through `oidc/routes.ts` and nothing else.
- Tests drive `buildApp()` over `inject()`, or one feature on
  `testing/fastify.ts`'s `testFastify()`; nothing listens on a port.
- `npm run check:conventions` runs `check-structure` strict over this folder.
