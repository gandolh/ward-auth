# Ward

The estate's sign-in: an OpenID Connect provider (Fastify and SQLite) that
every app's "Sign in with Ward" goes through, its React login page and admin
console, and `ward-auth`, the library apps vendor. Read
[corpus/index.md](corpus/index.md) first.

## Commands

- `npm run check`: typecheck, lint, format check, conventions, tests. Run it
  before every hand-back.
- `npm run check:fast`: the typecheck, then ESLint on the changed files. The
  Stop hook runs it.
- `npx vitest run <file>`: one test file.
- `npm run format`: Prettier writes every file it covers (Markdown stays out).
- `npm run dev`: the API on 127.0.0.1:8791. The UI is
  `npm run dev -w @ward/ui`, on localhost:5174.
- `npm run keygen`: a signing key for a local Ward.
- `npm run vendor -- <app>/vendor/ward`: build the library and copy it into
  an app.
- `npm run house-style:sync`: refresh `vendor/house-style/` (never edit it).

## Places that mislead

- Two dev ports: 8791 is the API, 5174 the UI, and Vite forwards `/ward-api`
  to the API with the prefix stripped, as Caddy does in production. Ward in
  local Docker is a third, 8792 (`infrastructure/local/README.md`).
- `.env` sits at the repo root, not in `api/`, and `api/src/config.ts` is the
  only reader of it.
- The image builds `api/` only: `ui/` is not in it, and its deps stage copies
  only `tsconfig.base.json` from the root, which is why that file holds the
  house flags itself.
- `docs/` is a workspace without `"type": "module"`, a Docusaurus site with
  its own ranges, outside lint, format and knip; `typecheck` still checks it.
- `shared-library/` is what apps copy, as a built bundle with its comments.
  A change in it needs a version and a `CHANGELOG.md` entry.
- `typecheck` is incremental: its build info sits in `node_modules/.tmp/`.

## Hard rules

- Ward is every app's sign-in. No change to a route, a cookie, a token
  format or an error body without saying so first.
- **No secrets.** Never write a password, token or key into the corpus or
  the repo. Name a secret by its variable, never by its value.
- **No CI.** No GitHub Actions, runners or other GitHub-specific automation.
- Deploys are owner steps: `node cli.ts ward deploy`, from the vps-deploy
  checkout.

## brief-board

Brief progress goes on brief-board. Run `brief-board guide` before you
start or resume a brief, and follow it.
