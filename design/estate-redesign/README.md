# The redesign: "The pass and its doors"

This folder is the design record of Ward's redesign. The estate redesign board, where it was drawn and approved, is a private canvas; this is a copy of the app's page on it plus the build behind that page. The owner approved it on 2026-11-13, and [brief 07](../../corpus/briefs/done/07-a-redesign-with-hallmark-on-the-estate-board.md) built it. The code is now the source of truth: where the app and these files differ, the app wins, and later work may have moved a screen on. Read this folder to see what was decided and why before reshaping a screen.

## The owner's decisions

The owner approved the whole board on 2026-11-13, with every question standing at what the board proposed unless they reopened it. The questions this app's page asked:

- **Ask:** 1. A web font on the sign-in path? index.css records "no webfont: a font on the login path is a render block". The build would self-host one Albert Sans subset (woff2, font-display: swap, a metric-matched fallback); the other option keeps the system stack on the public pages and uses Albert Sans only in the lazy console chunk. 2. Panels on the public pages? The account groups sit on cards and the sign-in form on a left-hung card, against "shadows, barely" and "a door, not a lobby". 3. Approve The pass and its doors (B) as Ward's direction, over Dressed limestone (A)?
- **Reopened:** Recorded in ui/src/styles/index.css: "Shadows, barely: depth here would make a door look like a dialog"; and in ui/src/components/Threshold.tsx: a centred card "reads as a destination, a lobby you have arrived in". Proposed: cards on the account page, and the sign-in form on one card hung off the jamb, left-aligned, never centred, with a 1 px border and one soft shadow (border plus a lighter surface in dark).

Where the files below disagree, the later layer wins: the owner's decisions, then the controller's rulings, then the judges' rulings, then the directions file.

## What is here

| Path | What it holds |
|---|---|
| `directions/ward-auth.md` | The director's brief: both directions (the winner is the one built), the shared fixture and the screens to draw. |
| `judge/ward-auth/RESULT.md` | The blind judging against today and the rulings that came with the win. |
| `critiques/ward-auth-controller.md`, `critiques/ward-auth.md` | The design critic's review against today, and the controller's rulings over it. |
| `manifests/ward-auth.tokens.css`, `manifests/ward-auth.tokens-map.md` | The token hand-off in the app's own names, and the renamed, new and unused tokens. |
| `manifests/ward-auth.board-notes.md` | What the board said beside the screens: the asks, decisions, reopened rules, open questions, the contrast table and the runner-up. |
| `work/ward-auth/twins/*.html` | Each drawn screen as static HTML, light and dark: open one in a browser. |
| `work/ward-auth/shots/` | The twins rendered at 1280 and 390, light and dark, WebP. `direction.webp` is the board's direction sheet. |
| `shots/ward-auth/` | Today's screens as the board showed them before the redesign. |

People's names and data in the pictures come from seeded demo accounts or are invented.

## Not here

The sketches and the judges' images, the runner-up's build (its notes are in the board's notes), the build's scripts, and the screenshots taken while it was built. They stay in the estate build folder.
