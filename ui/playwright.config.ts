import { defineConfig } from "@playwright/test";

/*
 * The UI's browser specs, against the Vite dev server with `/ward-api` answered by the stubs in `e2e/fixtures.ts`,
 * so no Ward runs and nothing reaches the API port. Port 5198 is not the dev port (5174), so `npm run dev` beside it
 * doesn't clash; `--strictPort` fails rather than drifting to another port. The browser is pinned to en-GB and UTC,
 * so the frozen fixtures read the same everywhere. Two workers at most: other work shares the machine.
 */
export default defineConfig({
  testDir: "e2e",
  workers: 2,
  reporter: "line",
  use: {
    locale: "en-GB",
    timezoneId: "UTC",
    baseURL: "http://localhost:5198",
  },
  webServer: {
    command: "npx vite --port 5198 --strictPort --host localhost",
    url: "http://localhost:5198/login",
    reuseExistingServer: false,
  },
});
