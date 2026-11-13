# Brief 07 — A redesign with Hallmark, on the estate board

**Depends on:**

- In ward-auth: [brief 05](../done/05-the-ui-to-tailwind.md), which puts the UI in Tailwind on its own token names, splits the sign-in pages' stylesheet from the console's, and adds the Light / Dark / System switch for the public pages; and [brief 04](../done/04-base-ui-by-the-conventions.md), which puts the Base UI wrappers in the console's own `ui/` folder. A redesign is then mostly a new token set and layout.
- In the owner's skills library:
  - brief 24, which vendors Hallmark as the design skill and adopts taste-skill 2.5's ideas (palettes and type dealt by trade, its copy layer);
  - the estate redesign board: one artifact with a page per app, owned by the skills library.
- The owner's answer of 2026-11-10 (Q39): no bake-off; Hallmark redesigns every web UI, keeping what is useful from taste-skill 2.5, and the owner approves each app on the board before any code changes.

**Runs before:** nothing. **Runs after:** 03 to 05, the redesign last. Brief 06 is server-only and does not block it.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

Ward is the estate's identity service and an OIDC provider that every app signs in through. Its UI is two surfaces: the **public pages** (sign in, register, verify an email, the self-service account page), seen by everyone who signs in to anything in the estate, and the **console**, a dark admin surface for the owner (accounts, grants per app, apps and their OIDC clients, an audit trail). The redesign covers both, and **changes no route, cookie or token format**: it is the UI's look and layout only.

### The screens (read 2026-11-10, `ui/src/app.tsx`, `ui/src/pages/console/routes.tsx`, `ui/src/pages/console/nav.ts`)

| Screen | Route | File |
|---|---|---|
| Log in (and the gate's states, the notices) | `/login` (`/` redirects here) | `ui/src/pages/Login.tsx`, `ui/src/components/Threshold.tsx`, `ui/src/components/Field.tsx`, `ui/src/components/Notice.tsx` |
| Register | `/register` | `ui/src/pages/Register.tsx` |
| Verify an email (valid, expired, empty token) | `/verify` | `ui/src/pages/Verify.tsx` |
| Self-service account: grants, change password, sign out other devices, the theme control | `/account` | `ui/src/pages/Account.tsx` |
| Not found | `*` | `ui/src/app.tsx` |
| Console login | `/console` (signed out) | `ui/src/pages/console/Login.tsx` |
| Console: accounts, and an account's detail (access, roles, sessions, danger zone) | `/console/accounts`, `/console/accounts/:subject` | `ui/src/pages/console/Accounts.tsx`, `ui/src/pages/console/AccountDetail.tsx` |
| Console: apps, and an app's detail (its OIDC client form, keys) | `/console/apps`, `/console/apps/:slug` | `ui/src/pages/console/Apps.tsx`, `ui/src/pages/console/AppDetail.tsx`, `ui/src/pages/console/OidcClient.tsx` |
| Console: audit | `/console/audit` | `ui/src/pages/console/Audit.tsx` |
| The console's shell: the rail, headers, the confirm dialog, the new-item forms | every console page | `ui/src/pages/console/routes.tsx`, `ui/src/pages/console/ui/Confirm.tsx`, `ui/src/pages/console/ui/Collapsible.tsx` |
| The provider's bare error page | shown by the OIDC provider | `api/src/oidc/provider.ts` (inline styles) |

### What the design docs fix today

- There is no design document for the UI. [wiki/decisions.md](../../wiki/decisions.md) holds the recorded calls:
  - "The UI is a console plus a minimal self-service page" (two surfaces, the self-service page deliberately minimal);
  - "The console's widgets are Base UI; the public pages import none" (the sign-in pages download no Base UI, and focus after a confirmed write is found again by its `data-wc-focus` key);
  - the console's dark surface, set by `data-ward-surface="console"` and not by the user's colour scheme, so that it looks visibly unlike the ordinary login page (the comment at the top of the console surface in `ui/src/tokens.css` says why);
  - [wiki/decisions-oidc.md](../../wiki/decisions-oidc.md) on the sign-in moment: every app has its own "Sign in with Ward" button, and Ward's login page is reached through it.
- The theme switch is the owner's call of 2026-11-10 (Q18): Light / Dark / System on the public pages, light on a first visit, on `data-theme`; the console stays its own dark surface (brief 05, decision 2). The redesign keeps that split unless the owner reopens it on the board.
- Ward keeps its per-app token names (`--ward-*` into Tailwind's namespaces) until this redesign; a rename is a change this brief may propose.
- The page the owner's other apps hand their sign-in moment to is a third visual identity ([wiki/decisions.md](../../wiki/decisions.md), "There is one login page, and it lives in Ward", revised 2026-10-13). A redesign of the sign-in pages therefore has to sit between very different apps without borrowing one of them.

The redesign stays inside these decisions unless the owner reopens one on the board.

## Owner decisions

Answered 2026-11-10: Q39 (Hallmark, with taste-skill 2.5's useful parts; approval on the board first). Default: the proposal keeps the two surfaces, the minimal self-service page, the dark console, the Base UI-free sign-in pages and the `data-wc-focus` rule. Anything that moves one of those is flagged on the board as a reopened decision.

No PRs, no branches (Q4): one commit per step, straight on `main`.

## Files you OWN

- `ui/src/styles/index.css` (and the console's second stylesheet, if brief 05 split it): the tokens.
- The screens listed above under `ui/src/`, one commit each, for class names and layout.
- A design document recorded from the shipped result (`docs/design.md`, new), linked from [wiki/decisions.md](../../wiki/decisions.md).
- `api/src/oidc/provider.ts`: only the inline style of the bare error page, and only if the board approves restyling it.
- Corpus: [wiki/decisions.md](../../wiki/decisions.md) (the visual direction, if it changes), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- **Routes, cookies and token formats.** Paths, methods, status codes, `Set-Cookie` headers and token claims stay byte-identical; every app signs in through Ward.
- `api/` beyond the one inline style above, and `shared-library/`.
- `ui/src/pages/console/focus-after-write.ts`, its test and every `data-wc-focus` attribute (27): moving a class must not move the attribute or its element.
- Behaviour and copy: only the look and layout change, and wording stays unless the board approves a change. No invented facts or numbers.
- The public pages stay free of Base UI imports, and the entry chunk's sourcemap stays free of any `@base-ui` source.
- `docs/` (the Docusaurus site) beyond the new design document.

## What to do

1. **Today.** Take Playwright screenshots of every screen above at 1280 and 390 px, in light and dark for the public pages and in the console's own surface, kept out of git. Use a scratch API and database ([wiki/status.md](../../wiki/status.md) names the local Ward), not the shared container. Include the sign-in page's error and notice states, verify's three states, the account page, each console screen with a confirm dialog and a new-item form open.
2. **Propose.** With Hallmark (and taste-skill 2.5's trade palettes and copy layer where they help), make a proposal per screen, inside the recorded decisions. Check each against the Floor: contrast, a visible focus ring, a reduced-motion path, no invented facts, no broken phone layout.
3. **Board.** Put the proposals on this app's page of the estate board, beside today's screenshots at both widths.
4. **Approval.** The owner approves on the board. Nothing below starts before that, and the approval is recorded in `log.md` with its date.
5. **Build.** First as a token change in `ui/src/styles/index.css` (colours, radii, shadows, type, spacing, the public light and dark themes, the console surface), then one screen per commit. Keep the Base UI wrappers, the theme switch and the focus rule working.

## Acceptance

- [ ] The owner's approval is on the board and recorded in `log.md` with the date.
- [ ] Contrast: every text and icon pair clears 4.5:1 (3:1 for large text and UI parts) in the public light theme, the public dark theme and the console surface, measured with a script over the built tokens and listed in the outcome note.
- [ ] A Playwright test tabs through each screen and asserts a visible focus ring on every stop.
- [ ] A Playwright test with `reducedMotion: "reduce"` asserts no running animation or transition on each screen.
- [ ] A Playwright test at 390 px asserts `document.documentElement.scrollWidth <= window.innerWidth` on each screen.
- [ ] Every figure and name shown comes from the data or the copy; the outcome note lists none invented.
- [ ] The theme switch still gives Light, Dark and System on the public pages, light on a first visit, and the console keeps its own surface under each choice; brief 05's theme tests pass.
- [ ] The entry chunk's sourcemap still lists no Base UI source (brief 04's command prints `0`), `grep -rc "data-wc-focus" ui/src` still totals 27, and `git diff HEAD~N -- ui/src/pages/console/focus-after-write.ts` is empty.
- [ ] The before and after request snapshots of the sign-in, session, token and OIDC routes are identical: no route, cookie or token format changed.
- [ ] `npm run check` passes, and `bash corpus/lint.sh` ends clean.

## Interplay

- Brief 05 owns the token names, the stylesheet split and the theme switch; this brief changes values and layout on top of it. If the proposal renames the `--ward-*` tokens, that is raised on the board.
- Brief 04's wrappers (`Confirm`, `Collapsible`) stay Base UI and are restyled in their own files.
- The skills library's brief 25 (the security audit) runs on ward-auth first (Q34, 2026-11-10), well before this brief; its findings become ward-auth briefs of their own and may touch the sign-in pages' code, so this brief starts from whatever they leave.
- Brief 03's formatter and lint run on every redesign commit.

## Outcome

Approved on the estate redesign board on 2026-11-13 ("The pass and its doors", over "Dressed limestone", every question standing as proposed) and built the same day on `main`, committed and not pushed. Steps 1 to 3 were the board's; this brief built step 5. The approval is in `log.md`; the design as shipped is [docs/design.md](../../../docs/design.md), and the decision, quoting the two calls it changed, is in [wiki/decisions.md](../../wiki/decisions.md).

**What changed.** The token values in all three blocks, with `--ward-accent-soft` new in each; `--ward-focus` is now the colour of a solid 2 px outline, 2 px off. The type scale has a line height per size, the card radius (14 px), the account page's widths, the band height and the console's 1000 px list fold are new tokens; `--shadow-ward-focus`, `--text-2xl` and `--container-ward-wide` went once nothing used them. Albert Sans (the variable latin file) and Fragment Mono, both 5.3.0 exact, self-hosted with `font-display: swap` and a fallback face matched to Albert Sans's metrics. Screens, one commit each: sign-in (and the shell every public page shares), the account page, the console's accounts and its shell, then the undrawn console screens. The approved copy edits only: the six em dashes ended as sentences, and the two "estate's" lines with U+2019.

**Undrawn screens restyled** with the new tokens and the direction's patterns, no new layout: register (the form on the sign-in card), verify (valid, expired, empty token), not found, the account page's loading, unreachable and signed-out states (their action drawn as the direction sheet draws it: Try again as the outline, Sign in as the primary), the console login, an account's detail (access, roles, sessions, danger zone) and its Confirm dialog, apps, an app's detail with the OIDC client form, the audit log and the Collapsible new-item forms. The provider's bare error page and the server-rendered OIDC pages are untouched.

**Against the comps** (Playwright renders of the board's twins, callouts hidden, against the build's shots on the stubbed data; a pixel differs when a channel moves by more than 24):

| Screen | 1280 light / dark | 390 light / dark | What differs |
|---|---|---|---|
| Sign in | 0.3 % / 0.3 % | 0.7 % / 0.7 % | glyph edges only |
| Account | 0.5 % / 0.5 % | 7.6 % / 5.2 % | on the phone the pass sits 4 to 5 px higher than the twin (its title-to-label gap), so every line below shifts; page 1786 px against 1791 |
| Console accounts | 1.6 % | 4.5 % | the rows are 4 px shorter each on the phone (1122 px page against 1142); the 1280 table's columns are sized by the table, not the twin's grid |

On a phone's first screen the reach heading is at y 592 at 390x844 and at 360x800 (the twin's 597); the Password card's edge and heading top (y 831) show at 844 but the heading is cut, and is below the fold at 800. The folds, measured: the console's table from 1000 px (hidden at 999); the account page's two columns from 900; the phone layout below 640 (Tailwind's `max-sm:`, by Q62), not the comps' 600.

**Contrast**, by a script over the built stylesheet's three blocks, every text and icon pair: text minimums 5.09 light (faint on the ground), 5.56 dark (faint on a card), 5.03 console (accent on accent-soft); edges, icons and rings 3.17, 3.52 and 3.05. Cards on the ground 1.23 and 1.19 with edges at 1.37 and 1.64; the console's 1.16. The disabled primary in the lockout and pending states keeps its look under hover in both themes, checked in Chromium.

**Data.** Every name and figure is the board's or Ward's: the five invented accounts, four apps and nine grants. The board drew only alex's two grants, so the other seven are this build's spread over the same people and apps; on the stubs Shelfmark is open to signups so that the register form shows; the session family id and the audit rows mirror what the scratch Ward wrote for the same seed.

**Checks.** `npm run check` exit 0 (73 files, 1273 tests). Playwright 1.62.0 (`npm run e2e -w @ward/ui`, Chromium, two workers) on a stubbed Ward, 65 passed: a visible ring on every Tab stop, nothing running under reduced motion, no sideways scroll at 390 in both public themes, on 16 screens and states; the switch light on a first visit with a dark system, each stored choice from the first paint, the choice kept across a reload, the console's own ground (`#181a1c`) under light, dark and system. The entry chunk's sourcemap lists 0 `@base-ui` sources (the console's 103); `grep -rc data-wc-focus ui/src` totals 27; `focus-after-write.ts` and its test, `api/`, `shared-library/`, `infrastructure/`, `ui/index.html`, `ui/vite.config.ts` and the two API clients have no diff. The request snapshot (36 replies from a scratch Ward run from a clone with no `.env`: sign-in, session, refresh, logout, the account routes, session-status, notify, verify, register, OIDC discovery, JWKS, authorize and token, the console's login and session), with cookie values, tokens and times normalised and the names, attributes, statuses and claims kept, was identical before the first code commit and at the last: 36 of 36.

**Sizes** (gzip level 9): sign-in CSS 4,893 B before, **6,078 B** after, past the about-5 kB line of Q21 (the split is already applied; asked on the board); console CSS 4,113 to 4,684 B; entry JS 81,780 to 82,580 B; console JS 51,213 to 51,889 B. One Albert Sans woff2 (32 kB) and one Fragment Mono woff2 (25 kB, with its woff fallback).

**Deviations.** (1) The phone fold is `max-sm:` (below 640 px), not 600, by Q62 (no phone variant). (2) The account grid splits at 900 with an arbitrary `min-[56.25rem]:` (the map has no token for it). (3) `--breakpoint-ward-list` is 62.5rem, by the build sheet, not the map's 68.75rem. (4) Playwright needed `eslint.config.js` (the specs as Playwright files), `ui/tsconfig.json` (the specs typechecked) and `.gitignore` (its output), outside the files this brief owns. (5) The console's accounts are drawn twice, a table and a list, one hidden by `display: none` at each width, so the table keeps its real headings. (6) The docs site's own stylesheet still says it has no web font; `docs/` beyond the design document was not touched.

**Left for later.** The server-rendered OIDC pages and the provider's error page keep their inline styles and drift further from the sign-in pages. The board's ready-for-deploy move asks the owner about the CSS size. Not pushed; the owner deploys with `node cli.ts ward deploy`.
