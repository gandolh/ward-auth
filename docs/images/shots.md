# README images

How each image was made, so the next refresh is a re-run. Re-take an image when the screen it shows
changes.

| File | Shows | How to reach that state | Viewport | Data | Taken |
| --- | --- | --- | --- | --- | --- |
| sign-in.webp | The login page as an app's visitor sees it | press "Sign in with Ward" on a local atrium's login page, which lands on `/ward/login?oidc=<uid>` headed "Continue to Atrium"; then blur the focused field | 840×620 @2x | none, empty form | 2026-10-09 |
| account.webp | The account page: who you are, what you can reach | sign in as the atrium tester account, open `/ward/account` | 1000×560 @2x | local tester account | 2026-10-09 |
| console-apps.webp | The admin console's app list | sign in at `/ward/console` with the break-glass login, open Apps | 1200×640 @2x | apps registered by `infrastructure/local/seed.mjs` | 2026-10-09 |

All three come from the local Ward in Docker
([infrastructure/local/README.md](../../infrastructure/local/README.md)), not from production. The
console shot lists what that copy's database holds, so it can include apps that are registered but
no longer, or not yet, signing in through Ward.

sign-in.webp was taken on 2026-10-09 through the old `?next=/atrium/` link. Since brief 30
(2026-10-13) `?next=` accepts only Ward's own pages and the "Continue to" heading appears only for
an OpenID Connect sign-in, so the recipe above is the one to use next time. Expect small differences
from the committed image, such as the OIDC page's "Back to" link.

Before re-taking one, check nothing personal is on screen: no real names or emails, and no client keys.
The Accounts page lists every local account, so it is not used here.

Capture: `agent-browser --session <name> set viewport <w> <h> 2`, open the page, wait for network
idle, `screenshot <absolute path>.png`, then
`ffmpeg -i shot.png -c:v libwebp -quality 82 shot.webp`.

The "How it works" diagram in the main README is a Mermaid block, so it has no image file. The
interactive diagrams on the docs site are built from `docs/diagrams/`.
