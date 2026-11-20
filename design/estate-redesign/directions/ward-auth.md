# ward-auth (Ward): two directions

Written 2026-11-12 by the art director. Repo: ward-auth (checkout `wzd_auth`), brief 07. Both directions keep the recorded calls (`corpus/wiki/decisions.md`, `decisions-console.md`, brief 07's defaults): two surfaces, a deliberately minimal self-service page, the console as its own dark surface on `data-ward-surface="console"` whatever the theme says, no Base UI on the public pages, all 27 `data-wc-focus` attributes, Light / Dark / System on the public pages with light on a first visit, and no change to a route, cookie, token or copy (em dashes included). The token names stay `--ward-*`: `bg`, `surface`, `surface-sunken`, `border`, `border-strong`, `text`, `text-muted`, `text-faint`, `accent`, `accent-hover`, `accent-text`, `danger`, `danger-surface`, `notice`, `notice-surface`, `shadow`, `shadow-lg`, `focus`. One new name: `accent-soft`, for the checked theme choice and B's role chip.

**Registry.** Lichen green (public, today's, OKLCH hue about 158 at chroma 0.03) and the console's brass-amber (today's) stay in both directions, so the judges compare structure. That is 7 to 8° from postern's patina (165) and sports-app's mint (166), but at a third of their chroma it reads as grey-green, not as either. The brass sits near lantern's amber, but it is today's, and only the console uses it. Faces: Overpass + Overpass Mono (A), Albert Sans + Fragment Mono (B). None of them appears in `registry.md` or in any directions file, and `theme.mjs check --face` clears all four.

## 1. Today's strengths (keep all of them)

1. **The task is the headline; Ward stays small.** The `h1` names the job (`Sign in`, `Your account`). The wordmark is a `<p>` in the corner and the smallest type on the page.
2. **One spine across every public page.** The left-hung column on the jamb (a hairline with a short heavier cap) is the same on sign-in, register, verify and account, so the pages read as one building.
3. **Facts set as facts.** `Who you are` is a labelled two-column list. The account id is in mono because it's read character by character.
4. **Access said plainly.** `Read-only.` comes first, then one row per app with its roles right-aligned between hairlines. Nobody else's data appears.
5. **One accent per screen.** The only solid button is the accent. Secondary actions are outlines. `danger` is kept for destroying things and is never used for a wrong password.
6. **Every state is written.** Loading, unreachable, signed out, no access yet, each notice and the lockout countdown all have their own honest sentence. The theme control is three native labelled radios.

**Faults both directions fix** (measured with `tools/color.mjs`):
- **Surfaces don't separate.** `surface` on `bg` is 1.11 in public light, public dark and the console alike (Floor: 1.09 with an edge, 1.15 in dark).
- **Field edges are too faint.** `border-strong` on `surface` is 2.39 / 2.40 / 1.96, under the 3:1 a field edge needs.
- **Console faint text fails.** It is 3.36 on `surface`.
- **The focus ring is too weak.** It is a 30 %-alpha shadow, 1.67 in light and 2.19 in dark once composited. Both directions make it a solid 2 px `accent` outline with a 2 px offset.
- **The console at 390 overflows.** The accounts table scrolls sideways, the subject wraps to six lines and the row action is clipped. Both directions turn rows into list items: username and state, the subject on one truncated mono line, and `Access and state` as a 48 px row link.
- **The shots show a fallback face.** They show the capture machine's sans, not what Android renders. Judge type from the sketches.

## 2. The main screen

**The self-service account page, `/account`, signed in as alex,** in its public shell:
- **1280:** `light-1280-account.png`, dark `dark-1280-account.png`;
- **390:** `light-390-account.png`, dark `dark-390-account.png`.

All four are in `board/shots/ward-auth/`, viewport-only (1280×800, 390×844).

**Why not sign-in:** the sign-in has eight elements, and its one structural alternative, a centred card, is argued against in `Threshold.tsx`. Account is the page the code calls "read rather than crossed". It is where a sign-in lands when `?next=` is refused, and it carries the public shell, both themes and the theme control.

**The full build** adds sign-in (`*-signin.png`) and console accounts (`*-console-accounts.png`) as screens 2 and 3. Each direction says below how it carries to them.

## 3. The content fixture (word for word)

The shot stops at 800 px. Everything from `New password` down is copied from `ui/src/pages/Account.tsx`: the signed-in branch, every `CAN_*` flag true, no notice showing.
- **Shell:** wordmark `Ward`. Footer: `Signed in as alex. Ward keeps the estate's accounts.`
- **Head:** `Your account`, then `One account for every app here. What you can reach in each of them is set per app, below.`
- **`Who you are`:**
  - `Username` `alex`;
  - `Account id` `473142503450100f9056018471d6d7b7` (mono);
  - `Email` `None on record — this account was created from the console.`
- **`What you can reach`:** `Read-only. Changing any of this is done by whoever runs the estate.` Then two rows, as slugs (the open-apps list names neither): `satchel` `user`; `shelfmark` `user`.
- **`Password`:**
  - `Current password`;
  - `New password`, with the hint `At least 8 characters.`;
  - `New password again`;
  - the button `Change password`, with the hint `Signs out every other device that was signed in as you. This one stays signed in — it gets a fresh session automatically.`
- **`Other devices`:** `Ends every other signed-in session and leaves this one alone. Worth doing if you think somebody else has your session.` Button `Sign out my other devices` (danger outline).
- **`Theme`:** `Light, dark, or whatever your device uses. Kept on this device only.` Radios `Light` `Dark` `System`; the one checked matches the artboard's theme.
- **`Sign out`:** `Ends this session only, on this device. Signed in as alex.` Button `Sign out` (quiet).
- **States strip** (Direction sheet, copy from `Account.tsx`):
  - loading: `Your account` / `Loading.`;
  - unreachable: `Ward isn't answering` / `Your session is probably fine — Ward just didn't respond. Try again.` / `Try again`;
  - signed out: `You're signed out` / `Sessions end after a while, and this one has. Sign in to see your account.` / `Sign in`;
  - no access: `No app access yet. Access is granted per app by whoever runs the estate — ask them, and it will appear here.`;
  - field error: `The two new passwords don't match.`;
  - result: `No other sessions were signed in.`

## 4. Directions

Palette by role. A and B share the console's values (the last column). The public pages' values are their own.

| Role | A light | A dark | B light | B dark | Console (both) |
|---|---|---|---|---|---|
| bg | `#efeee8` | `#141614` | `#e9e8e1` | `#121412` | `#18191c` |
| surface | `#ffffff` | `#222622` | `#ffffff` | `#202520` | `#24262a` |
| surface-sunken | `#e5e4dd` | `#101210` | `#f1f0eb` | `#181b18` | `#111214` |
| border / border-strong | `#d3d1c8` / `#85837a` | `#363c36` / `#727a71` | `#cfcdc3` / `#83817a` | `#363c36` / `#727a71` | `#3a3d42` / `#6c7077` |
| text / muted / faint | `#191b19` / `#4a4f49` / `#5f645b` | `#e9ebe7` / `#b5b9b2` / `#979c93` | `#191b19` / `#4a4f49` / `#5d6259` | as A dark | `#e8e6e1` / `#a9a7a1` / `#97958e` |
| accent / accent-hover / accent-text | `#33473a` / `#24312a` / `#f5f6f2` | `#a3c2ab` / `#b9d4c0` / `#122019` | `#2f4a3a` / `#223829` / `#f5f6f2` | as A dark | `#c09152` / `#d0a262` / `#18191c` |
| accent-soft (new) | `#e2e9e3` | `#26332a` | `#dfe8e1` | `#26332a` | `#33291c`, always with a 1 px `accent` edge (1.06 on surface) |
| danger / danger-surface | `#8a2e21` / `#f9eae7` | `#ec917f` / `#3a2320` | as A light | as A dark | `#e47a66` / `#34211d` |
| notice / notice-surface | `#5e4c0e` / `#faf2d8` | `#dcbf6b` / `#2f2914` | as A light | as A dark | `#d8b25e` / `#302915` |

Pre-checked (A light / A dark / B light / B dark / console):
- surface on bg 1.16 / 1.19 / 1.23 / 1.19 / 1.16;
- border-strong on surface 3.80 / 3.46 / 3.90 / 3.52 / 3.05;
- faint on surface 6.07 / 5.48 / 6.26 / 5.56 / 5.06, and faint on sunken 4.76 / 6.71 / 5.48 / 6.20 / 6.25;
- accent on surface 9.99 / 7.94 / 9.72 / 8.06 / 5.35; accent-text on accent 9.20 / 8.72 / 8.95 / 8.72 / 6.21; on hover 12.5 / 10.6 / 11.6 / 10.6 / 7.56;
- danger on danger-surface 7.20 / 6.19 / 7.20 / 6.19 / 5.27; notice on notice-surface 7.46 / 8.08 / 7.46 / 8.08 / 7.19;
- the focus ring (`accent`) on bg 8.59 / 9.41 / 7.91 / 9.57 / 6.21.

Re-run `contrast.mjs` over the built tokens. The two darks must stay visibly two buildings: public dark is green-black with lichen, the console is cool graphite with brass and its hazard band (`#d8b25e` stripes, 8.75 on bg).

### A. Dressed limestone (Evolve today)
- **Idea:** today's door and its spine, finished: the same left-hung column on the jamb, with each group of the account page on its own panel so the page reads in blocks.
- **Skeleton:**
  - **1280.** Today's three rows: the wordmark at top left, the column, the footer line. The column hangs at today's `clamp(0rem, 7vw, 9rem)` and widens from 36 to 40 rem. `Your account` and the lede sit on the ground. Under them hang five `surface` panels, radius 10, with a 1 px `border` and `shadow` in light (border only in dark), 16 px apart, 24 px padding:
    1. `Who you are`;
    2. `What you can reach`, the rows inside the panel with hairlines;
    3. `Password`;
    4. `Other devices`;
    5. `Theme` and `Sign out`, the two things that touch only this device, as two `h2`s in one panel split by a hairline.

    Reading order is unchanged.
  - **390.** The same column. The jamb sits at the 20 px gutter with a 16 px indent, panels run full width, the account id wraps in mono, and buttons are 48 px tall.
- **Type:** Overpass (Google, `family=Overpass:wght@400;600;700`), a signage face for a page that works as a signpost; Overpass Mono 400 for the account id only. Sizes: 12/16 footer and hints; 14/20 labels, the `dl`, grant rows and buttons; 16/24 prose on phone and inputs; 20/28 at 700 for the `h2`s; 34/40 at 700 for the `h1` (28/34 at 390). The wordmark is 14/20 at 600 in `text-muted`, still the smallest heading-like type.
- **Signature:** the jamb, lit. Today's hairline runs the full column with a 3 px `accent` cap at the `h1`, and the panels hang 24 px off it. It is a separate rule, never a stripe on a card.
- **Carries to:**
  - **sign-in:** today's skeleton exactly, with the form on the ground and no panel (the door stays a door). Only the face, the colours, the field edges and the ring change.
  - **console:** today's header, hazard band and 192 px rail; the table on a `surface` panel; the 390 list rows above.
- **Reference:** `hashicorp`, for infrastructure that states things plainly on neutral surfaces with one hairline weight. Nothing of its palette or type.
- **Reopens:** panels on a public page. `index.css` says "shadows, barely". A keeps them to the account page.

### B. The pass and its doors
- **Idea:** the account page as the pass you hold. Who you are sits in one held card beside the page, and what it opens and what you can do with it fill the column next to it.
- **Skeleton:**
  - **1280.** A 56 px top band on `surface` with a `border` foot holds the wordmark (`Ward`, 14/20 600 `text-muted`) and nothing else. Ward has one place, so no tabs and no invented navigation. Below it, the page hangs from today's jamb offset (not centred), max 1040 px. The head (`Your account` and the lede) hangs off a short jamb with a 3 px `accent` cap. Under the head is a grid of a 320 px pass column and a 1fr column (max 640), 24 px apart.
    - **The pass:** a `surface` card, radius 14, `shadow-lg` in light and border plus surface step in dark, sticky 24 px under the band. It holds `Who you are`, then `Username` as a small label over `alex` at 28/32 700, then `Account id` in mono 13/20 on one line, then `Email`. A hairline follows, then `Sign out` with its prose and a full-width quiet button at the card's foot.
    - **The cards:** four `surface` cards on the right, radius 14, a 1 px `border` and `shadow`:
      1. `What you can reach`: prose, then the two rows, each role in an `accent-soft` chip with a 1 px `accent` edge;
      2. `Password`: `Current password` full width; `New password` and `New password again` side by side at 1280 (folding at 600); the button and its hint;
      3. `Other devices`;
      4. `Theme`: the three radios as one segmented row, the checked one `accent-soft` with `accent` text and a 1 px edge.
  - **390.** The band, the head, then the pass (not sticky), then the four cards in today's order. Only `Sign out` moves, up into the pass. Content runs to the end with 24 px of foot padding, and there is no bottom bar.
- **Type:** Albert Sans (Google, `family=Albert+Sans:wght@400;500;600;700`), a calm, slightly geometric grotesk with clear figures; Fragment Mono 400 for the account id only. Sizes: 12/16 footer and hints; 14/20 labels, rows and buttons; 16/24 prose and inputs; 18/24 at 600 for card titles (`h2`); 28/32 at 700 for the pass username; 32/40 at 700 for the `h1` (26/32 at 390).
- **Signature:** the pass. One held card carries everything about you, from the name at display size and the id to sign out, and it stays beside you while the right column scrolls.
- **Carries to:**
  - **sign-in:** the same band. The form sits in one pass-sized card hung on the jamb, left-aligned and never centred, with the heading and lede above it on the ground.
  - **console:** today's header and hazard band; the rail; the accounts list as a card; the 390 list rows above.
- **Reference:** `wise`, for an account page where the identity summary sits in its own card beside grouped setting cards. Nothing of its palette (no lime) or type.
- **Reopens:** panels on public pages (as A), and the sign-in form on a card. `Threshold.tsx` argues against a card because it reads as a lobby; B answers with a left-hung card on the jamb, never a centred one. `Sign out` moves from last to inside the pass.

## 5. Registry lines

| ward-auth (A) | Dressed limestone | Overpass | Overpass (+ Overpass Mono for ids) | lichen green (today's, very low chroma); console brass-amber with the hazard band (today's) | wordmark corner, the left-hung column on a full-height jamb, the account page as five hung panels, the sign-in form on the ground; console: header + hazard band, 192 px rail, a table panel; phone: the same column, console rows as list items |
| ward-auth (B) | The pass and its doors | Albert Sans | Albert Sans (+ Fragment Mono for ids) | lichen green (today's); console brass-amber (today's) | a 56 px wordmark band; the head on a short jamb; a 320 px sticky pass card (identity and Sign out) beside a column of four cards; the sign-in form in a left-hung card; phone: pass, then cards, no bottom bar |

## 6. Questions for the owner (ask sticky)

1. **A web font on the sign-in path?** `index.css` records "no webfont: a font on the login path is a render block". The build would self-host one subset woff2 (Overpass or Albert Sans) with `font-display: swap` and a metric-matched fallback. The other option keeps the system stack on the public pages and uses the face only in the lazy console chunk.
2. **How far may surfaces go on the public pages?** Both directions put the account page's groups on panels. B also puts the sign-in form on a left-hung card, against "a door, not a lobby" (`Threshold.tsx`).
3. **Approve this direction:** A or B?
