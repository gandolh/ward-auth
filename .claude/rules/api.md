---
paths:
  - "api/src/**"
---

# The API (`api/src`)

- Ward is the OIDC provider every app signs in through. A change to a route,
  a cookie, a token or an error body changes every app: say so before you
  make one.
- `config.ts` is the only reader of the environment; it parses and checks it
  once, and exits with the variable named when something is wrong.
- The lazy `await import("../config.js")` (18 sites) is deliberate:
  `buildApp()` must not touch the database or the config before `index.ts`
  has migrated. Don't hoist them to static imports.
- Failures keep the repo's error bodies, `{ error: "<code>" }`, with the
  status the route documents. A 500 is `{ error: "internal" }` from the one
  handler in `app.ts`, and never echoes a thrown message.
- A malformed body is a client bug, not a lockout failure: it gets a 400 and
  spends no lockout budget.
- The lockout key comes from `lockoutKeyFor` (`auth/lockout.ts`), which
  applies `WARD_TRUSTED_PROXIES` to the forwarded address; never from
  `request.ip`.
- The OIDC provider is mounted through `oidc/routes.ts` and nothing else.
- Tests drive `buildApp()` over `inject()`; nothing listens on a port.
- `npm run check:conventions` runs `check-structure` over this folder,
  `--warn-only` until the server moves to its new structure.
