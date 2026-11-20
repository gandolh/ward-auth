# Ward tokens: board role to app token

Mechanism: unchanged. Ward keeps raw `--ward-*` variables in `index.css` (public light under `:root`, public dark under `:root[data-theme="dark"]`, the console under `[data-ward-surface="console"]`) and maps them in `theme.css` with `@theme inline`. The board drew its files with the app's own names, so no role is renamed. `ward-auth.tokens.css` has two parts: the raw blocks for `index.css`, and the `theme.css` edits.

## Renamed or remapped (board role to app token)
- Every colour, shadow and font role on the board is the app's own name (`--ward-bg`, `--ward-surface`, `--ward-surface-sunken`, `--ward-border`, `--ward-border-strong`, `--ward-text`, `--ward-text-muted`, `--ward-text-faint`, `--ward-accent`, `--ward-accent-hover`, `--ward-accent-text`, `--ward-danger`, `--ward-danger-surface`, `--ward-notice`, `--ward-notice-surface`, `--ward-shadow`, `--ward-shadow-lg`, `--ward-focus`); only the values change.
- `--ward-focus` changes meaning: it was a box-shadow value (a 30 % ring) and is now a colour for a solid 2 px outline with a 2 px offset. That touches the base `:focus-visible` rule in `index.css` (given in the file), the `--shadow-ward-focus` line in `theme.css` (drop it) and `"ward-focus"` in the shadow group of `lib/cn.ts` (drop it). The 27 `data-wc-focus` attributes are untouched.
- Console values are the direction file's table: faint text 3.36 to 5.08 on surface, border-strong 1.96 to 3.05 on surface; `body:has([data-ward-surface="console"])` holds the console ground as a literal, so it moves from `#17181a` to `#181a1c` with `--ward-bg`.
- Fonts: `--font-ward` and `--font-ward-mono` take Albert Sans and Fragment Mono in front of today's stacks (self-hosted subset, owner question 1).
- Type: `--text-xs/sm/base` keep their size and take explicit line heights (16, 20, 24 px) in place of the shared 1.5; `--text-lg` 1.25rem to 1.125rem (18/24 at 600); `--text-xl` stays 1.75rem with a 32 px line; `--text-ward-signpost` clamp becomes `clamp(1.625rem, 1.4rem + 0.9vw, 2rem)` (26 px on a phone, 32 from 1280).
- Radii: `--radius-ward` 6px to 8px; `--radius-lg` stays 10px.
- Public `--ward-shadow` is the one card elevation (border plus soft shadow in light, none in dark where the surface step does the work); `--ward-shadow-lg` is now used only by the console's confirm dialog.

## New tokens (component that needs them)
- `--ward-accent-soft`, `--color-ward-accent-soft`: the checked Theme choice (public); a brass-tinted fill for the console that is always drawn with a 1 px accent edge.
- `--color-ward-focus`: the outline colour for `:focus-visible` and any component that needs the ring by name.
- `--radius-ward-card` (14 px): every card, the pass and the sign-in card.
- `--text-ward-mono` (13/20): the account id in the pass, the console's subject column and timestamps (12 px on a phone).
- `--container-ward-account` (65rem) and `--container-ward-pass` (20rem): the account page's grid, a 320 px pass beside a 640 px column.
- `--height-ward-band` (3.5rem): the wordmark band on every public page.
- `--breakpoint-ward-list` (68.75rem): under 1100 px the console's account table becomes list rows (username and state, the subject on one mono line, created and the 48 px `Access and state` link).

## App tokens the design no longer uses (keep or drop is the code brief's call)
- `--shadow-ward-focus` and `--ward-focus` as a shadow value: replaced by the outline rule above.
- `--container-ward-wide` (36rem): the account page now sits in `--container-ward-account`; sign-in keeps `--container-ward`.
- `--text-2xl` (2.375rem): the destination line is `--text-ward-signpost`; nothing else uses it.
- `--ward-shadow-lg` on the public pages (kept for the console dialog).
- `--breakpoint-console` (60rem) still switches the rail to a row; it is unchanged.
- The page's `Threshold.tsx` jamb cap (`after:h-8 after:w-0.5 ... bg-ward-border-strong`) becomes a 3 px, 44 px `bg-ward-accent` cap, and the jamb rule becomes `bg-ward-border-strong`: component edits, no token change.
