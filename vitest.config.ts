import { defineConfig } from "vitest/config";

/**
 * One Vitest project at the repo root rather than per-workspace configs.
 *
 * Ward's tests are all Node-side today and share one concern — the database
 * layer and the token layer both want a real `better-sqlite3` and a real
 * `jose`, not a browser environment — so a single root project keeps `npm test`
 * meaning one thing. `ui/` will need a different environment; when
 * it does, that is the moment to split this into projects, not before.
 *
 * `pool: "forks"` because `better-sqlite3` is a native addon: worker threads
 * sharing one addon instance across tests is the class of flake that is
 * miserable to debug, and process isolation costs a few hundred milliseconds
 * on a suite this size.
 */
export default defineConfig({
  test: {
    /**
     * `ui/` is included since 2026-09-04. The header above says a UI test suite
     * would be the moment to split this into projects — that moment has not
     * arrived, because **no DOM environment is configured and the UI has not
     * needed one**: everything under `ui/` that is tested here is pure logic (the
     * `?next=` allowlist, the API error mapping, the retry-after formatting),
     * which runs in Node exactly as the API's tests do. The first component
     * test that needs a document is the thing that justifies `jsdom` and a
     * per-project environment; adding either before then would slow the whole
     * suite down for no coverage.
     *
     * That test exists since 2026-11-11 (`Confirm.test.tsx`). A test file asks
     * for a document with a `// @vitest-environment jsdom` docblock, so the
     * root project stays in Node.
     */
    /**
     * `shared-library/` joined on 2026-10-13. Its tests are Node-side too: the
     * React hooks are thin wrappers over a framework-free client, and the
     * client is what is tested, with a fake `fetch`. `.scratch/` holds the
     * vendor smoke test's throwaway copies and is never a test source.
     */
    include: ["api/**/*.test.ts", "ui/**/*.test.ts", "ui/**/*.test.tsx", "shared-library/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "shared-library/.scratch/**"],
    pool: "forks",
  },
});
