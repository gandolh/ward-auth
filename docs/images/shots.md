# README images

How each image was made, so the next refresh is a re-run. Re-take an image when the screen it shows
changes.

| File | Shows | How to reach that state | Viewport | Data | Taken |
| --- | --- | --- | --- | --- | --- |
| sign-in.webp | The login page as an app's visitor sees it | press "Sign in with Ward" on a local atrium's login page, which lands on `/login?oidc=<uid>` (on `/ward/login` before Ward moved to its own host on 2026-10-22) headed "Continue to Atrium"; then blur the focused field | 840×620 @2x | none, empty form | 2026-10-09 |
| account.webp | The account page: who you are, what you can reach | sign in as the atrium tester account, open `/account` | 1000×560 @2x | local tester account | 2026-10-09 |
| console-apps.webp | The admin console's app list | on a scratch copy (below), sign in at `/console` with its break-glass login, open Apps, then blur the focused link | 1200×720 @2x | the seven apps `infrastructure/local/seed.mjs` lists, registered closed | 2026-10-27 |

sign-in.webp and account.webp come from the local Ward in Docker
([infrastructure/local/README.md](../../infrastructure/local/README.md)), and console-apps.webp from
a scratch copy. None comes from production.

console-apps.webp was retaken on 2026-10-27 against a scratch API, so it shows only the apps
registered for the shot, not whatever a long-lived database still holds. The recipe: make a
temporary directory, write a throwaway signing key into it with
`npx tsx api/src/tokens/keygen.ts <dir>/signing-key.pem`, and start `npx tsx api/src/index.ts` from
the repo root with `PORT=8791`, `WARD_DB_PATH`, `WARD_SIGNING_KEY_PATH` and `WARD_MAIL_FILE_DIR`
inside that directory, `WARD_MAIL_TRANSPORT=file`, `WARD_PUBLIC_ORIGIN=http://localhost:5199`, and a
made-up `WARD_ADMIN_USERNAME` and `WARD_ADMIN_PASSWORD` passed in the environment, never written
into the repo. Start the UI with `npx vite --port 5199` in `ui/`; its dev server proxies
`/ward-api` to port 8791. Sign in with `POST /ward-api/console/login`, register each app with
`POST /ward-api/console/apps` (`{ slug, name }`), take the shot, then stop both and delete the
directory. Seven rows need the 720 px viewport.

sign-in.webp was taken on 2026-10-09 through the old `?next=/atrium/` link. Since
2026-10-13 `?next=` accepts only Ward's own pages and the "Continue to" heading appears only for
an OpenID Connect sign-in, so the recipe above is the one to use next time. Expect small differences
from the committed image, such as the OIDC page's "Back to" link.

Before re-taking one, check nothing personal is on screen: no real names or emails, and no client keys.
The Accounts page lists every local account, so it is not used here.

Capture: `agent-browser --session <name> set viewport <w> <h> 2`, open the page, wait for network
idle, `screenshot <absolute path>.png`, then
`ffmpeg -i shot.png -c:v libwebp -quality 82 shot.webp`.

The "How it works" diagram in the main README is a Mermaid block, so it has no image file. The
interactive diagrams on the docs site are built from `docs/diagrams/`.
