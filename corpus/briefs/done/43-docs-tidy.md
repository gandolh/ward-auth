# Task 43: Docs tidy: format, status, Satchel's host, the console shot

## Context

Asked for by the owner on 2026-10-27. Four small things in the docs have drifted:

- `npm run fmt:check` fails on `ui/src/lib/next.test.ts` and `README.md`. Briefs 34
  to 42 each noted it and left it alone, because neither file was theirs.
- The README's status line says brief 32 "moves" Ward to `ward.<domain>` "with its
  next deploy". It is live: [status.md](../../wiki/status.md) records the release of
  2026-10-22, found live on 2026-10-24.
- `docs/cutover-oidc.md` step 4 gives Satchel the redirect URI
  `<origin>/satchel-api/auth/ward/callback` and the sign-out return URI
  `<origin>/satchel/`. Since satchel's brief 15 (2026-10-22) Satchel lives at the
  root of its own host, and its `docs/owner-setup.md` registers
  `https://satchel.<domain>/satchel-api/auth/ward/callback` and
  `https://satchel.<domain>/`. The runbook's note on Ward's own host also says the
  apps' redirect URIs did not change, which is no longer true of Satchel.
- The README's console screenshot is from 2026-10-09 and lists imbatranim-os, which
  left Ward on 2026-10-07, and not shelfmark or almanac.

Hosts are written as the docs already write them: `<origin>`, `ward.<domain>`,
`satchel.<domain>`. The production domain never goes into a doc.

## Files you OWN

- `README.md`, `ui/src/lib/next.test.ts` (formatting only)
- `docs/cutover-oidc.md`
- `docs/images/console-apps.webp`, `docs/images/shots.md`

## Files you must NOT touch

- Any other repo, satchel included: its docs are the source, not the target.
- The local Ward in Docker at `localhost:8792`: no reseed, wipe or config change.
  `infrastructure/local/seed.mjs` writes into the apps' env files, so it isn't run.
- `docs/docs/wiki/`, which the docs build generates.

## What to do

1. README status: Ward is in production since 2026-10-04 and on its own host,
   `ward.<domain>`, since the release of 2026-10-22 (brief 32).
2. Prettier on `README.md` and `ui/src/lib/next.test.ts`, after the README edit.
3. Satchel's row in step 4 gets its own host's two URIs, and the note on Ward's
   host says Satchel's moved with satchel's brief 15.
4. Recapture `console-apps.webp` with `shots.md`'s capture recipe, against a scratch
   API on a scratch database under `/tmp/claude-1000/`: a throwaway signing key, a
   made-up break-glass login set in the environment only (never in a file in the
   repo), and the seven apps `seed.mjs` lists, registered closed through the
   console API. The UI's dev server proxies `/ward-api` to `127.0.0.1:8791`; run it
   on a port other than 5173. Seven rows need a taller viewport than the old 640.
   If the console can't be run this way, skip the shot and say so.
5. Update the README's alt text and `shots.md`'s row (data, viewport, date) to the
   way the shot was taken, so the next refresh is a re-run.

## Acceptance

- `npm run fmt:check` passes.
- No doc calls Ward's own host pending; Satchel's URIs match its own docs.
- The console shot shows the seven apps, no personal data and no client keys.
- `npm run typecheck`, `npm run lint` and `npm test` still pass.

## Outcome (2026-10-27)

Done in one docs commit (`fa9a56a`).

- **Status.** The README says Ward is in production since 2026-10-04, on
  `ward.<domain>` since the release of 2026-10-22 (brief 32), and at `/ward/` on the
  production site before that. The paragraph is rewrapped by hand: the repo's
  Prettier preserves prose wrapping, so it doesn't rewrap a long line. The
  README's docs-site links stay at `/ward/docs/`, where `docusaurus.config.ts` and
  the corpus still put it. status.md's history line for brief 32 said "built, not
  deployed" and is corrected in the record.
- **Prettier** changed `README.md`'s Project layout table (column widths, after the
  `ward.<domain>` row grew) and wrapped one object in `ui/src/lib/next.test.ts`.
  Nothing else.
- **Satchel.** Step 4's row now reads
  `https://satchel.<domain>/satchel-api/auth/ward/callback` and
  `https://satchel.<domain>/`, as satchel's `docs/owner-setup.md` registers them.
  The note on Ward's host now says Ward's move changed no app's redirect URIs, and
  Satchel's changed with its own move (satchel's brief 15).
- **The console shot** was retaken at 1200×720 @2x. It ran against a scratch API
  (`api/src/index.ts` on port 8791) on a database, throwaway signing key and mail
  directory in a temporary directory under `/tmp/claude-1000/`, with a made-up
  break-glass login. The password was random, kept in a mode-600 file in that
  directory and passed in the environment. The UI's dev server ran on port 5199.
  The seven apps `seed.mjs` lists (almanac, atrium, newspapper, prm, satchel,
  shelfmark, sports-app) were registered closed through the console API. No
  account was created, because the Apps page shows none. Focus was blurred before
  the capture, then the PNG went through
  `ffmpeg -c:v libwebp -quality 82`. Both servers were stopped and the
  directory deleted afterwards. The local Ward at `localhost:8792` wasn't touched.
  It didn't answer from WSL during the run anyway. `shots.md` has the recipe, and
  the README's alt text has the new list and date.

Checked: `npm run fmt:check` passes ("All matched files use Prettier code
style!"); typecheck, lint and the 1231 tests pass; no edited doc names the
production domain. brief-board is down, so nothing was posted there.
