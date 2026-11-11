---
paths:
  - "shared-library/src/**"
---

# The shared library (`shared-library/src`)

- Apps vendor this library as a built copy (`npm run vendor -- <app>/vendor/ward`).
  So a change to its API or its behaviour needs a new version in
  `shared-library/package.json` and a `CHANGELOG.md` entry with an upgrade
  note saying exactly what an app must change.
- The bundles keep their comments (`scripts/build.mjs`): they ship, and app
  owners read them.
- No Fastify or React import in `core/`: it is the part both bundles share.
- No `process.env` outside the two documented fallbacks:
  `AUTH_TRUSTED_PROXIES` in `fastify/plugin.ts` and the `WARD_OIDC_*`
  variables in `ward/client.ts`'s `wardClientOptionsFromEnv`. Both, and the
  test harness's writes, are lint warnings until the library's exceptions
  are recorded.
- `testing/ward-harness.ts` boots a real Ward in-process for the library's
  tests. It is test-only: neither bundle imports it.
- `npm run check:conventions` runs `check-structure` over this folder too.
