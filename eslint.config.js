import { houseStyle } from "./vendor/house-style/eslint.config.js";

/**
 * Flat ESLint config: the house config from the vendored house-style copy,
 * given Ward's folders. The rules, and the reason for each, are in the copy.
 *
 * Deliberately thin: `tsconfig.base.json` already turns on `strict`,
 * `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters` and
 * `noImplicitOverride`, so the compiler is the primary gate and this file only
 * adds what a type checker cannot see. Rules duplicated from the compiler are
 * worse than absent — they report the same problem twice, in two formats, and
 * drift apart.
 *
 * Every file in the repo is linted, `docs/` aside. That was not true for most
 * of this build — the root `lint` script globbed `api/src/**` alone, so the UI
 * and the old reference client were never seen by it, and later the globs
 * still left out the root configs, `ui/vite.config.ts` and the local seed. A
 * gate that covers less than it appears to is worse than no gate, so `lint` is
 * `eslint .` and the ignores below are the whole list of what it skips.
 */
export default [
  ...houseStyle({
    root: import.meta.dirname,
    // React, and its hooks rules, which are not decoration: Newspapper's config
    // records how `set-state-in-effect` and `refs` each hid real findings
    // behind a config-level blanket. The compiler rules are not exhaustive (they
    // bail out silently on some components), so a clean run means "nothing
    // found", not "nothing there".
    web: ["ui/src", "shared-library/src/react"],
    server: "api/src",
    // Scripts run by hand, which print and read the environment directly: the
    // repo's own, the library's build and vendor scripts, and the local seed.
    scripts: ["scripts", "shared-library/scripts", "infrastructure/local"],
    // Allowed to print: the config loader reports a bad environment before any
    // logger exists, the key loader warns at boot the same way, and the OIDC
    // client-key generator is a CLI.
    console: ["api/src/config.ts", "api/src/tokens/keys.ts", "api/src/oidc/client-keygen.ts"],
    // A test helper that asserts counts as an assertion.
    assertFunctionNames: ["expect", "expectTypeOf", "expectRefused"],
    // docs/ is a Docusaurus site with its own typecheck and its own ranges;
    // .scratch/ holds the vendor smoke test's throwaway copies.
    ignores: ["docs/**", "shared-library/.scratch/**"],
  }),
  {
    // A warning for now (2026-11-11): the library reads the environment in two
    // documented fallbacks, AUTH_TRUSTED_PROXIES in the Fastify plugin and the
    // WARD_OIDC_* variables in wardClientOptionsFromEnv. When the library's own
    // exceptions are recorded with its structure, this block goes: each read
    // becomes a recorded exception or moves.
    name: "ward/library-process-env-warns",
    files: ["shared-library/src/fastify/plugin.ts", "shared-library/src/ward/client.ts"],
    rules: { "n/no-process-env": "warn" },
  },
];
