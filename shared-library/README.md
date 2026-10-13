# ward-auth (shared library)

Local accounts, sessions and lockout for the estate's apps, shipped as a built
bundle each app copies into `vendor/ward/`. The design is in
`corpus/wiki/decisions-oidc.md`. Brief 21 adds "Sign in with Ward" and turns
this page into the full adoption guide.

## Commands

| Command | What it does |
|---|---|
| `npm run build --workspace=shared-library` | Builds `dist/` (two bundles, two `.d.ts`) |
| `npm run vendor -- <dir>` | Builds, then writes the six-file copy into `<dir>` |
| `npm test` (repo root) | Includes this workspace's tests |

`<dir>` is resolved from where you ran `npm`. Run `vendor` over an existing
copy to upgrade it; it refuses a directory holding anything else.

## Server, in short

```js
import Fastify from "fastify";
import Database from "better-sqlite3"; // or: import { DatabaseSync } from "node:sqlite";
import { createAccounts, createSqliteStore, wardAuth } from "./vendor/ward/ward-auth.js";

const accounts = createAccounts({ store: createSqliteStore(new Database("app.db")) });
const app = Fastify();
await app.register(wardAuth, {
  accounts,
  cookieName: "myapp_session",
  cookiePath: "/myapp/api", // the API prefix as the browser sees it
  publicOrigin: process.env.PUBLIC_ORIGIN,
  routePrefix: "/auth", // Fastify-side: POST /auth/login, /auth/logout, /auth/password, GET /auth/session
  publicRoutes: ["GET /health"],
});
// Register every app route after this; each has `request.auth`.
```

## Browser, in short

```js
import { configureAuth, useLogin, useSession } from "./vendor/ward/ward-auth-react.js";

configureAuth({ basePath: "/myapp/api/auth" });

function LoginPage() {
  const session = useSession();
  const { login, pending, error } = useLogin();
  // Render the app's own form; call login(username, password).
}
```

## Upgrading

Every version and its upgrade notes are in [CHANGELOG.md](./CHANGELOG.md).
