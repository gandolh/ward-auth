# The board's notes: Ward

The estate redesign board is a private canvas. This file copies what its page for this app said beside the screens: the owner's asks, the decisions, the rules the design reopened, the open questions and the Floor. The owner's answers are in [README.md](../README.md#the-owners-decisions).

## Asks to the owner

- 1. A web font on the sign-in path? index.css records "no webfont: a font on the login path is a render block". The build would self-host one Albert Sans subset (woff2, font-display: swap, a metric-matched fallback); the other option keeps the system stack on the public pages and uses Albert Sans only in the lazy console chunk. 2. Panels on the public pages? The account groups sit on cards and the sign-in form on a left-hung card, against "shadows, barely" and "a door, not a lobby". 3. Approve The pass and its doors (B) as Ward's direction, over Dressed limestone (A)? (beside `ward-auth-direction`)

## Decisions

- The pass: Who you are and Sign out in one card, sticky at 1280 under the 24 px page padding. It takes the same one elevation as the four cards beside it (border plus soft shadow in light, border plus surface step in dark), not the heavier shadow the sketch gave it. Sign out moves here from last place. (beside `ward-auth-proposed-account-1280`)
- Read-only roles are plain muted text, right-aligned, exactly as today. There is no chip, pill or edge, so nothing on that list looks clickable. (beside `ward-auth-proposed-account-1280`)
- New password and New password again sit side by side at 1280 and fold at 600. Every hint, At least 8 characters. included, is one 12/16 size. (beside `ward-auth-proposed-account-1280`)
- Theme is one segmented row of the three native radios; the checked one is accent-soft with accent text and a 1 px accent edge. It is the only place accent-soft appears on a public page. (beside `ward-auth-proposed-account-1280`)
- The jamb stays Ward's: the head hangs off a hairline with a 3 px accent cap, and sign-in hangs its card off the same rule. The wordmark stays the smallest type on the page, in a 56 px band (48 on a phone) that carries nothing else. (beside `ward-auth-proposed-account-1280`)
- On a phone the pass tightens: Sign out puts its caption and button on one row, and the band drops to 48 px. The email value is 16 px, the same as the Sign out caption in that card. There is no sticky bar on the phone, so nothing hides under one. (beside `ward-auth-proposed-account-390`)
- Sign-in keeps today's skeleton (band, jamb, one line of footer) and puts the form on a 416 px card hung from the jamb. The primary button is full width in the card; the footer link is a 44 px target. At 600 px and under the jamb stops under the lede, as on the account page, and the card runs the full content width (350 px at 390, fields 316), so no rail narrows the phone. (beside `ward-auth-proposed-signin-1280`)
- Copy edits so no em dash is left (lint gate 19): email line, "None on record — this account was created from the console." to "None on record. This account was created from the console."; Change password hint, "...signed in as you. This one stays signed in — it gets a fresh session automatically." to "...signed in as you. This one stays signed in. It gets a fresh session automatically."; console break-glass line, "Break-glass credential — every route here changes authority" to "Break-glass credential. Every route here changes authority". The direction sheet's states change the same way (unreachable, no access, empty list). The apostrophe in "estate's" is the typographic one in the comps. The code brief changes the same strings. (beside `ward-auth-proposed-account-1280`)
- The Username field draws its focus ring, as today's shot does (autofocus). The ring is a solid 2 px accent outline, 2 px off, in both themes; today's 30 % shadow measured 1.67 in light. (beside `ward-auth-proposed-signin-1280`)
- The console keeps its dark surface whatever the theme says (data-ward-surface="console"), its brass accent and the hazard band; both theme artboards draw it the same, on purpose. Faint text and field edges are lifted to pass (5.08 and 3.78). (beside `ward-auth-proposed-console-accounts-1280`)
- The accounts table sits on a card with a header row; from 1000 px up it is the full table; from 601 to 1000 each row is two lines (name, created and state, then the subject whole and Access and state); at 600 and under it is a list row with the 48 px link, so nothing scrolls sideways at 390. The subject is not truncated. (beside `ward-auth-proposed-console-accounts-1280`)
- Albert Sans and Fragment Mono are both on Google Fonts [conv]. Fragment Mono carries ids and timestamps only, as the console's mono rule says. (beside `ward-auth-direction`)

## Reopened rules

- Recorded in ui/src/styles/index.css: "Shadows, barely: depth here would make a door look like a dialog"; and in ui/src/components/Threshold.tsx: a centred card "reads as a destination, a lobby you have arrived in". Proposed: cards on the account page, and the sign-in form on one card hung off the jamb, left-aligned, never centred, with a 1 px border and one soft shadow (border plus a lighter surface in dark). (beside `ward-auth-proposed-signin-1280`)

## The Floor

- Contrast is scripted over 55 pairs. Public text min 5.09 light and 5.56 dark; edges, icons and rings min 3.17 and 3.52; console text min 5.03, edges 3.05. Cards on the ground: 1.23 light and 1.19 dark (each also has a 1.37 / 1.64 edge); console 1.16. No page overflow at 1280, 1024, 768, 390 or 360 in either theme, no control spills its box, and targets are 44 px (48 at 600 and under). First screens, today to build: account 1280x800 adds Sign out and Change password; account 390x844 holds the whole pass and both app rows with the What you can reach heading at y 597 (today 432), and 360x800 the same; sign-in shows form, button and footer at all three; console 1280 shows all 5 rows, console 390 and 360 show 3 whole rows at 844 and 2 at 800 (today 2 and a bit). Sloplint --scope app --render: 0 FAIL, 0 REFLEX, 0 WARN on all six Proposed twins. The direction sheet draws states for all three screens. (beside `ward-auth-direction`)

## Other notes

- Ward has no menus or toasts on the public pages: results and errors are inline notices (error, wait, info) and the console has alerts, so the components strip draws those instead. The confirm dialog is not redrawn.
- The Theme radios show the artboard's theme through CSS, not a checked attribute, so both artboards stay one file. The 1000, 900 and 600 px folds were checked at 1024, 768, 390 and 360. The disabled primary no longer reacts to hover.
- Handoff: manifests/ward-auth.tokens.css and ward-auth.tokens-map.md carry the tokens in the app's own names, including the focus ring change from a shadow to an outline colour.

## Contrast, as measured

| Pair | Light | Dark | Needs |
|---|---|---|---|
| text on bg | 14.1 | 15.43 | 4.5 |
| text on surface | 17.32 | 12.99 | 4.5 |
| text on sunken | 15.18 | 14.48 | 4.5 |
| muted on bg | 6.82 | 9.3 | 4.5 |
| muted on surface (prose, labels, wordmark) | 8.38 | 7.83 | 4.5 |
| muted on sunken (unchecked segment) | 7.34 | 8.73 | 4.5 |
| faint on surface (hints) | 6.26 | 5.56 | 4.5 |
| faint on bg (footer) | 5.09 | 6.6 | 4.5 |
| faint on sunken | 5.48 | 6.2 | 4.5 |
| accent on surface (links) | 9.72 | 8.06 | 4.5 |
| accent on bg (links in the footer) | 7.91 | 9.57 | 4.5 |
| accent-text on accent (primary button) | 8.95 | 8.72 | 4.5 |
| accent-text on accent-hover | 11.61 | 10.62 | 4.5 |
| accent on accent-soft (checked segment) | 7.76 | 6.83 | 4.5 |
| danger on surface (danger button) | 8.42 | 6.62 | 4.5 |
| danger on danger-surface (error notice) | 7.2 | 6.19 | 4.5 |
| accent-text on danger (danger hover) | 7.76 | 7.16 | 4.5 |
| notice on notice-surface (lockout) | 7.46 | 8.08 | 4.5 |
| border-strong on surface (button edge) | 3.9 | 3.52 | 3 |
| border-strong on sunken (field edge) | 3.42 | 3.92 | 3 |
| border-strong on bg (jamb rule) | 3.17 | 4.18 | 3 |
| accent on bg (jamb cap) | 7.91 | 9.57 | 3 |
| focus on surface (ring) | 9.72 | 8.06 | 3 |
| focus on bg (ring) | 7.91 | 9.57 | 3 |
| focus on sunken (ring) | 8.51 | 8.99 | 3 |
| surface on bg (card on ground; needs 1.09 light / 1.15 dark, or an edge) | 1.23 | 1.19 | 1.09 / 1.15 |
| border on bg (card edge on ground; needs 1.3) | 1.37 | 1.64 | 1.3 |
| border on surface (rule inside a card) | 1.68 | 1.38 | 1.2 |
| text on bg | 13.99 | 13.99 | 4.5 |
| text on surface | 12.05 | 12.05 | 4.5 |
| text on sunken (rail) | 14.94 | 14.94 | 4.5 |
| muted on surface | 6.32 | 6.32 | 4.5 |
| muted on bg | 7.34 | 7.34 | 4.5 |
| muted on sunken (rail links) | 7.84 | 7.84 | 4.5 |
| faint on surface (timestamps) | 5.08 | 5.08 | 4.5 |
| faint on bg | 5.9 | 5.9 | 4.5 |
| accent on surface (links) | 5.31 | 5.31 | 4.5 |
| accent on bg | 6.16 | 6.16 | 4.5 |
| accent on sunken (rail mark) | 6.58 | 6.58 | 3 |
| accent-text on accent (New account) | 6.16 | 6.16 | 4.5 |
| accent-text on accent-hover | 7.5 | 7.5 | 4.5 |
| accent on accent-soft | 5.03 | 5.03 | 4.5 |
| danger on surface | 5.21 | 5.21 | 4.5 |
| danger on danger-surface | 5.27 | 5.27 | 4.5 |
| accent-text on danger (danger hover) | 6.05 | 6.05 | 4.5 |
| notice on bg (break-glass line) | 8.68 | 8.68 | 4.5 |
| notice on notice-surface | 7.19 | 7.19 | 4.5 |
| notice on sunken (hazard band stripes) | 9.27 | 9.27 | 3 |
| border-strong on surface (button edge) | 3.05 | 3.05 | 3 |
| border-strong on sunken (field edge) | 3.78 | 3.78 | 3 |
| focus on surface (ring) | 5.31 | 5.31 | 3 |
| focus on bg (ring) | 6.16 | 6.16 | 3 |
| surface on bg (card on ground; needs 1.15) | 1.16 | 1.16 | 1.15 |
| surface on sunken (rail beside the ground) | 1.07 | 1.07 | 1.05 |
| border on bg (card edge) | 1.64 | 1.64 | 1.3 |

## The runner-up

**Runner-up: A, Dressed limestone (sketch only, not built)**

Note: how this direction was picked. Two directions were sketched (A evolve today, B the pass and its doors) and two judges compared every pair against today, in both orders, at 1280 light and 390 dark. All 12 verdicts agreed: B won 4, A 2, today 0. Today failed the structure gate in every pair: one flat sheet whose sections part only by whitespace and hairlines. B beat A on hierarchy and use of the width: the username at display size, Sign out and Change password on the first screen, two columns at 1280 where A leaves the right half empty. What A did better: more of the page on the phone's first screen, even card elevation, and a full-height rail that felt more like Ward's own. Say so here if you'd rather keep one hung column (A).

## The artboards on the board

- Direction · The pass and its doors
- Account · 1280 · light · today
- Account · 390 · light · today
- Sign in · 1280 · light · today
- Sign in · 390 · light · today
- Console accounts · 1280 · light · today
- Console accounts · 390 · light · today
- Account · 1280 · light · proposed
- Account · 390 · dark · proposed
- Sign in · 1280 · light · proposed
- Sign in · 390 · dark · proposed
- Console accounts · 1280 · light · proposed
- Console accounts · 390 · dark · proposed
- Runner-up A, Dressed limestone · light 1280 (sketch)
- Runner-up A, Dressed limestone · dark 390 (sketch)
