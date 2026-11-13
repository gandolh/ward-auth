# Ward's design: The pass and its doors

Recorded on 2026-11-13 from what shipped. The owner approved this direction on the estate redesign
board that day, over the runner-up "Dressed limestone". The decision, and the earlier calls it
changed, are in [corpus/wiki/decisions.md](../corpus/wiki/decisions.md), "The pass and its doors".

Ward is a door people pass through on their way to another app, plus a console for the one person
who runs the estate. The design keeps those two buildings apart. The account page is **the pass**:
who you are, held in one card beside the page. Sign-in hangs **one card off the jamb**, the vertical
rule every public page hangs from. The console stays **its own dark building**.

## The two surfaces

- **The public pages**: sign in, register, verify an email, the account page and the not-found
  page. A pale limestone ground with white cards in light, a green-black ground with lighter cards in
  dark. They follow Light / Dark / System on `data-theme`, light on a first visit. None of them loads
  Base UI.
- **The console**: graphite, brass and the hazard band, under `data-ward-surface="console"`,
  whatever the theme says. It should look visibly unlike the sign-in page, so that someone reaching
  for break-glass knows they have.

## Tokens

The raw `--ward-*` colours live in `ui/src/styles/index.css`, in three blocks: `:root` (public
light), `:root[data-theme="dark"]` (public dark) and `[data-ward-surface="console"]`.
`ui/src/styles/theme.css` maps them onto Tailwind's names with `@theme inline`. The names are the ones
move to Tailwind of 2026-11-11 set. Only the values changed, plus the few new names below.

| Token | Light | Dark | Console |
| --- | --- | --- | --- |
| `--ward-bg` | `#e9e8e1` | `#121412` | `#181a1c` |
| `--ward-surface` | `#ffffff` | `#202520` | `#242729` |
| `--ward-surface-sunken` | `#f1f0eb` | `#181b18` | `#111314` |
| `--ward-border` | `#cac8bd` | `#363c36` | `#3b3f42` |
| `--ward-border-strong` | `#83817a` | `#727a71` | `#6c7175` |
| `--ward-text` | `#191b19` | `#e9ebe7` | `#e8e6e1` |
| `--ward-text-muted` | `#4a4f49` | `#b5b9b2` | `#aaa8a2` |
| `--ward-text-faint` | `#5d6259` | `#979c93` | `#98968f` |
| `--ward-accent` | `#2f4a3a` | `#a3c2ab` | `#c09152` |
| `--ward-accent-hover` | `#223829` | `#b9d4c0` | `#d0a262` |
| `--ward-accent-text` | `#f5f6f2` | `#122019` | `#181a1c` |
| `--ward-accent-soft` (new) | `#dfe8e1` | `#26332a` | `#33291c` |
| `--ward-danger` | `#8a2e21` | `#ec917f` | `#e47a66` |
| `--ward-danger-surface` | `#f9eae7` | `#3a2320` | `#34211d` |
| `--ward-notice` | `#5e4c0e` | `#dcbf6b` | `#d8b25e` |
| `--ward-notice-surface` | `#faf2d8` | `#2f2914` | `#302915` |
| `--ward-focus` | `#2f4a3a` | `#a3c2ab` | `#c09152` |

- **Elevation.** One for every card, the pass included: a 1 px `--ward-border` plus `--ward-shadow`
  (two soft layers) in light. In dark, `--ward-shadow` is `none`, and a card is told from the
  ground by its lighter surface and its border. `--ward-shadow-lg` is the console's confirm dialog's
  alone.
- **Focus.** `--ward-focus` is a colour now, not a box-shadow. Every focusable element draws a
  solid 2 px outline in it, 2 px off the element, in both themes and in the console. On the Theme
  control the radio is invisible, so the ring is drawn on its segment.
- **Radii.** `--radius-ward` 8 px (controls), `--radius-lg` 10 px (the Theme track, the confirm
  dialog), `--radius-ward-card` 14 px (every card).
- **Sizes.** `--container-ward` 26rem (the sign-in card), `--container-ward-account` 65rem (the
  account page), `--container-ward-pass` 20rem (the pass), `--height-ward-band` 3.5rem (the wordmark
  band), `--breakpoint-ward-list` 62.5rem (the console's account table).

## Type

Albert Sans, self-hosted: the latin file of `@fontsource-variable/albert-sans` (one variable file,
400 to 700), with `font-display: swap`. A fallback face matches Albert Sans's metrics on a local
Arial (or its metric twins Liberation Sans and Arimo): size-adjust 104.18 %, ascent 91.19 %,
descent 24 %, measured from the file. The page draws at once in the fallback, and the swap moves
nothing. Fragment Mono (`@fontsource/fragment-mono`, latin, 400) carries ids and timestamps only.
Both packages are pinned at exactly 5.3.0.

| Size | Use |
| --- | --- |
| `text-ward-signpost`, 26 to 32 px, 1.25, 700 | the page's `h1`: the destination or the task |
| `text-xl`, 28/32, 700 | the username in the pass, the console's `h1` |
| `text-lg`, 18/24, 600 | card titles |
| `text-base`, 16/24 | inputs; prose on a phone |
| `text-sm`, 14/20 | labels, rows, buttons, prose on a wide screen |
| `text-xs`, 12/16 | hints, the pass's labels, the footer: one helper size |
| `text-ward-mono`, 13/20 | the account id, the console's subjects and times (12 px on a phone) |

## The screens

**The shell** (every public page). A 56 px band (48 px on a phone) holds the wordmark alone, the
smallest type on the page. Below it is the crossing, and below that one line of small print, its
link a 44 px target.

**Sign in.** Today's skeleton: band, jamb, footer. The heading and its lede hang off the jamb, a
hairline in `--ward-border-strong` with a 3 px, 44 px accent cap. Under them is one 416 px card
holding any notice, the two fields and the primary, full width. Nothing is centred. Below 640 px the
jamb stops under the lede and the card takes the whole content width (350 px at 390, fields 316).
The disabled primary (pending, or locked out) never reacts to hover. Register uses the same card for
its form. Verify and the not-found page hang their notice or link under the heading, at the card's
measure.

**The account page: the pass.** The heading hangs off its own jamb. Below it, from 900 px, sits a
320 px pass beside a 640 px column of cards. The pass holds Who you are and Sign out, and it is
sticky under the page padding. Each label is 12/16 faint, 4 px above its value. The username is
28/32, the account id is in Fragment Mono, and the email reads at body size. The column holds What
you can reach (roles as plain muted text, right-aligned, nothing that looks clickable), Password
(the two new-password fields side by side, stacked below 640 px), Other devices, and Theme. Theme is
one segmented row of the three native radios, capped at 360 px. The checked segment is
`accent-soft` with accent text and a 1 px accent edge, the only `accent-soft` on a public page.
Below 900 px it is one column, with nothing sticky. On a phone, Sign out's caption and button share
a row. The loading, unreachable and signed-out states keep the page's head and put their one action
under it.

**The console.** The top bar: wordmark, the break-glass line in `--ward-notice`, the session clock in
mono, and Sign out. Then the hazard band, the rail (44 px entries, the current one with a 3 px brass
edge) and the page: a 28/32 heading and a lede capped at 36rem. The accounts are one card. From
1000 px they are a real `<table>` with `<th scope="col">` headings. From 640 to 999 px each account is
a two-line row. Below 640 px it is three lines, with a 48 px Access and state link. The subject is
always whole. Every other console screen keeps its layout with the shared looks: panels are cards,
fields are 44 px wells (48 in the narrow layout), the empty state is a dashed card, and an error
alert reads in the danger colour. The confirm dialog keeps its 10 px radius and the heavy shadow.
Below 960 px the rail becomes a row and the top bar stacks by `order`, so the tab order never
changes.

## Rules that hold

- **One accent.** The solid accent marks only the one primary on a screen. `danger` marks only Sign
  out my other devices on the public side, and the destructive actions in the console.
- **No entrance motion.** The only motion answers something a person did. Under
  `prefers-reduced-motion` the one `!important` rule cuts every duration to 0.01 ms.
- **The folds.** Tailwind's `max-sm:` (below 640 px) is the phone, by the 2026-11-10 call that
  allows no phone variant. The comps drew that fold at 600 px. The account grid splits at 900 px, the
  console's table at 1000 px (`ward-list:`) and the console's shell at 960 px (`max-console:`).
- **What stayed.** The two surfaces, the minimal self-service page, the dark console, the public
  pages free of Base UI, the `data-wc-focus` rule and the `--ward-*` names.

## Contrast

Measured by a script over the built stylesheet's three token blocks, every text and icon pair the
UI draws. Text needs 4.5:1; edges, icons and rings need 3:1.

| Surface | Text minimum | Edge, icon and ring minimum |
| --- | --- | --- |
| Public light | 5.09 (faint on the ground) | 3.17 (strong border on the ground) |
| Public dark | 5.56 (faint on a card) | 3.52 (strong border on a card) |
| Console | 5.03 (accent on accent-soft) | 3.05 (strong border on a card) |

A card on the ground is 1.23:1 in light and 1.19:1 in dark, with a border at 1.37 and 1.64. The
console's card is 1.16:1, with a border at 1.64.

## Not redesigned

The provider's bare error page (`api/src/oidc/provider.ts`) and the server-rendered OIDC pages keep
their own inline styles. The board never drew them, so their restyle is not approved, and they now
drift from the sign-in pages' look.
