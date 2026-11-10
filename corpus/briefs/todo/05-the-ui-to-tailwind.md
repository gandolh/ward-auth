# Brief 05 — The UI to Tailwind, and a theme switch

**Depends on:**

- In ward-auth:
  - brief 03, for the gate, the formatter and the `.claude/rules/ui.md` this brief extends;
  - brief 04, which puts the Base UI wrappers in `ui/src/pages/console/ui/`, so this brief styles each part once, in its final place.
- In the owner's skills library:
  - brief 02, *A base-ui skill, styled with Tailwind*: rules 4-8, the `tailwind.md` reference and the method in `migrating-from-plain-css.md`;
  - brief 27, *A house style, and a quality harness that enforces it*: the `better-tailwindcss` lint;
  - brief 09, *ward-auth's UI to Tailwind*, the estate draft this brief replaces.
- The owner's grilling of 2026-11-10: Q17 and Q61 (token names), Q18 (the theme switch), Q19 (visual parity), Q20 (the order of the migrations), Q21 (the sign-in CSS budget), Q60 and Q62 (tests, type scale). All decided; see Owner decisions.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

On 2026-11-09 the owner decided that Base UI is styled with Tailwind v4 and that whole apps move to Tailwind. ward-auth's UI is plain CSS on tokens, in three files. This brief moves all of it to Tailwind 4.3.5 with the looks unchanged, adds the Light / Dark / System switch for the public pages, and **keeps two things the estate draft did not weigh**. Ward is the OIDC provider every app signs in through, so **no route, cookie or token format changes**: this is the UI's stylesheet and markup only.

1. the sign-in pages download no Base UI (brief 04 keeps that, and this brief must not undo it through the stylesheet);
2. the console is a **dark surface**, and the public pages a light one, switched by an attribute and not by the user's colour scheme.

### Corrections to the estate draft

- **Tokens.** `ui/src/tokens.css` has **43 distinct custom properties** and 62 definitions (the console surface redefines 19 of the colours, shadows, focus ring and width, `tokens.css:131-154`). The draft counted 43 and was right about the names, and said nothing about the redefinitions, which are the hard part.
- **Dark mode is not `prefers-color-scheme`.** `tokens.css:131` is `[data-ward-surface="console"] { … }` with the dark palette (`--ward-bg: #17181a`, `--ward-surface: #202225`, `--ward-accent: #b8894a`, …), set on `ui/src/app.tsx:77`, `ui/src/pages/console/Login.tsx:88`, `ui/src/pages/console/routes.tsx:144, 171` and on the portalled dialog's popup (`ui/src/pages/console/ui.tsx:257`). `tokens.css:176` paints the body to match with `body:has([data-ward-surface="console"])`. A reader who picks the light scheme still gets a dark console, deliberately: the console's spec is to look visibly unlike the ordinary login page (the comment at `ui/src/tokens.css:120`). So the console's dark is a surface and not a theme, and Q18's switch (Tailwind's `dark:` keyed off `data-theme`) applies to the public pages only. See decision 2.
- **The spacing scale is already Tailwind's.** The ten `--ward-space-*` tokens (`tokens.css:83-92`: 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, in `rem` at 0.25 per step) are exactly Tailwind's default `--spacing` multiples, so `p-4` is `var(--ward-space-4)` and none of them need declaring. The root font size is the browser's 16 px (no `html { font-size }` anywhere), so Q44 (a pixel size on `html` moves onto `body`) needs nothing here, and the `rem` scale does not shift.
- **Three sizes and one radius differ from the defaults.** `--ward-text-lg` (1.25rem), `-xl` (1.75rem) and `-2xl` (2.375rem) differ from Tailwind's 1.125, 1.25 and 1.5rem; `--ward-radius-lg` is 10 px against 8 px (`tokens.css:73-95`). `@theme` overrides the default names (`--text-lg`, `--text-xl`, `--text-2xl`, `--radius-lg`) with the old values, so no custom size name is invented and `tailwind-merge` needs no extension.

### The stylesheets today

Three files, **1,530 lines**, all under `ui/src/`, imported at three places:

| File | Lines | Imported by | Holds |
|---|---|---|---|
| `ui/src/tokens.css` | 193 | `ui/src/main.tsx:3` | the tokens, both surfaces, the body defaults, the reduced-motion rule |
| `ui/src/ward.css` | 440 | `ui/src/app.tsx:10` | the public pages: 30 class selectors in 53 rules, `ward-*` names |
| `ui/src/pages/console/console.css` | 897 | `ui/src/pages/console/routes.tsx:45` | the console: 54 class selectors in 118 rules, `wc-*` names, 15 attribute selectors |

Counted 2026-11-10 with `wc -l` and a selector count over the files with comments stripped; step 1 recounts with a CSS parser. Beyond those:

- **259 `className` attributes in 17 `.tsx` files**: 70 on the public side (`ui/src/pages/Account.tsx` 27, `Register.tsx` 15, `Verify.tsx` 8, `Login.tsx` 6, `ui/src/components/Threshold.tsx` 5, `Field.tsx` 4, `ui/src/app.tsx` 4, `Notice.tsx` 1) and 189 in the console.
- **Two built from data, and the Tailwind scanner cannot read them:** `ui/src/components/Notice.tsx:53` (`` `ward-notice ward-notice--${tone}` ``) and `ui/src/components/Threshold.tsx:35` (a conditional pair). The first needs a lookup map from tone to a full class string.
- **State-driven styling by attribute**, which becomes variants: `data-tone` (`danger`, `primary`, `notice`, `error`, `done`), `data-severity` (`alarm`, `notice`), `data-state` (`open`, `none`, `disabled`), all in `console.css`. The code sets them, apart from what `Collapsible` and `AlertDialog` emit themselves.
- **Media:** one `@media (max-width: 40rem)` in `ward.css:75`, one `@media (width <= 60rem)` in `console.css:828`, and `prefers-reduced-motion` in `tokens.css:186`, whose two `!important` (`tokens.css:190-191`) are the only ones in the UI. No `@container`, no `@keyframes`, no `@font-face`: the faces are system stacks.
- **One inline `style`**: `ui/src/app.tsx:103`, the loading line's margin and padding, which are not computed geometry. It becomes utilities.

### Sizes today (measured 2026-11-10)

On a scratch build, `npx vite build` in `ui/`, gzip level 9:

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.css` (the sign-in pages: `tokens.css` + `ward.css`) | 7,896 B | **2,164 B** |
| `routes-*.css` (the console, lazy) | 12,060 B | 2,400 B |
| `index-*.js` (entry) | 257,222 B | 80,359 B (Vite reports 81.45 kB) |
| `routes-*.js` (console, lazy) | 136,681 B | 40,459 B (Vite reports 40.90 kB) |

A bare `@import "tailwindcss"` with one utility, compiled with `tailwindcss` 4.3.5 and its CLI, is 4,228 B raw and **1,455 B gzip**: that is the preflight and theme floor. If one stylesheet carries both the public and the console utilities, an upper bound is 2,164 + 2,400 + 1,455 ≈ 6.0 kB gzip, which is past Q21's line of about 5 kB for what the sign-in pages download. That is an estimate with the overlap ignored, not a measurement; step 4 measures, and the second stylesheet of decision 3 is the likely outcome.

### Versions (verified 2026-11-10)

- `tailwindcss` 4.3.5, `@tailwindcss/vite` 4.3.5 (peer `vite ^5.2 || ^6 || ^7 || ^8`, and `ui/` is on Vite 8.3.5), `clsx` 2.1.1 and `tailwind-merge` 3.7.0, each pinned exactly. `eslint-plugin-better-tailwindcss` is the one brief 27 names; its peers accept ESLint 10.9.1, which the root pins.
- `ui/` is the only workspace that takes them. The Docker image builds `api/` only, so none of this reaches the image.

## Owner decisions

Decided on 2026-11-10 unless marked as a default.

1. **Token names** (Q17 and Q61, decided 2026-11-10, technical calls). Names name a role, never a value; the small-tools family (wicket, the-board, lantern) converges on `surface`, `ink`, `accent`, `line` and `danger`, and **other apps keep their names until their redesign**. So ward-auth keeps its per-app names 1:1: each `--ward-<name>` becomes `--color-ward-<name>`, `--text-*`, `--radius-*` or `--shadow-ward*` by the namespace Tailwind needs, with the value unchanged. The spacing tokens are dropped because they equal the default scale. Brief 07 (the redesign) is where a rename may come up.
2. **The two surfaces and the theme switch** (Q18, decided 2026-11-10, owner for the switch; the console's surface is a technical call, flagged below).
   - **Public pages: a Light / Dark / System switch, light by default.** A first visit shows the light theme, not the system's. `dark:` keys off a `data-theme` attribute through `@custom-variant dark`, not `prefers-color-scheme`. The public palette's dark values are one block in `@layer base` under `[data-theme="dark"]`, redefining the raw `--ward-*` colour variables, so every utility follows and no `dark:` utility is needed. The choice is kept on the device in `localStorage` (Ward keeps no per-user display settings). The control is on the self-service account page (`ui/src/pages/Account.tsx`), and it writes nothing to the API.
   - **The sign-in pages stay Base UI-free**, so the control is a native radio group (three `<input type="radio">` in a fieldset, styled), not a Base UI `RadioGroup`.
   - **The console keeps its own dark surface** (`data-ward-surface="console"`, which wins inside the console, because the console element declares the variables itself and a declaration on the element beats what it inherits from `<html data-theme>`). The console's spec is to look visibly unlike the public login page, and a theme switch on the public pages must not erase that, so the console is not a theme and has no light variant here. *Flagged for the owner: this is the one place Q18's "a switch everywhere" does not reach; confirm that the console stays dark-only, or ask for a light console as its own brief.*
   - The raw `--ward-*` variables stay as plain CSS in `@layer base`, and `@theme inline` maps the Tailwind colour names onto them (`--color-ward-surface: var(--ward-surface)`), because with a non-inline `@theme` the value is substituted on `:root` and neither the console's re-pointing nor the theme block would reach a utility. Step 2 proves the mechanism on the portalled dialog, which carries the attribute itself.
3. **The CSS budget** (Q21, decided 2026-11-10, technical call). The sign-in pages download only their own stylesheet. Start from one `ui/src/styles/index.css`; if the single stylesheet's gzipped size, which is what the sign-in pages would download, is past about 5 kB, split it: the public pages keep `index.css`, and the console's utilities go in a second stylesheet imported by the lazy console chunk. Record the split in `scripts/conventions.json` and the outcome note. The estimate above makes the split the likely outcome.
4. **Visual parity** (Q19, decided 2026-11-10, owner). Close enough: before and after screenshots at 1280 and 390 px, in light for the public pages and in the console's dark surface, show no visible change to layout or colour. A few pixels of drift in spacing or rounding needn't be fixed or listed. The public pages' dark theme is new and is checked for unreadable text only.
5. **The decision revisit** (default, as in the other apps). "The console's widgets are Base UI; the public pages import none" rejected shadcn **because it brings Tailwind**, and says the console is "styled by `console.css`". The owner's 2026-11-09 call reverses that reason. Revise the decision, keep its first half, say so with the date, and keep shadcn rejected for a reason of its own: Base UI is used directly, without a styled kit on top.
6. **`docs/`** (default). Out of scope. The Docusaurus site has its own `docs/src/css/custom.css` and its own theme.
7. **Tests** (Q60 and Q62, decided 2026-11-10, technical calls). The theme module's tests run under jsdom (brief 04 adds it); flows stay in Playwright. Tests select by role, and `data-testid` only where no role fits. The type scale is already a named scale: `--text-lg`, `-xl` and `-2xl` override Tailwind's names with Ward's values, and no arbitrary `text-[…]` sizes are written.
8. **No PRs, no branches** (Q4, decided 2026-11-10, owner). One commit per step, straight on `main`.

## Files you OWN

- `ui/src/**/*.css`: all three files are replaced by `ui/src/styles/index.css` (plus the console's second stylesheet under decision 3).
- The theme switch: `ui/src/theme.ts` with its test, the inline script and `color-scheme` meta in `ui/index.html`'s `<head>`, and the control in `ui/src/pages/Account.tsx`.
- `ui/src/lib/cn.ts` (new): `clsx` plus `tailwind-merge`.
- The `className`s and the one `style` prop in the 17 `.tsx` files above, and the two data-built classes (`ui/src/components/Notice.tsx:53`, `ui/src/components/Threshold.tsx:35`).
- The Base UI wrappers from brief 04, for their classes.
- `ui/src/main.tsx`, `ui/src/app.tsx` and `ui/src/pages/console/routes.tsx`: only the three CSS import lines.
- `ui/vite.config.ts` (the `@tailwindcss/vite` plugin), `ui/package.json` and `package-lock.json`.
- `eslint.config.js`: `better-tailwindcss`, in the config's own style, with the stylesheet entry point `ui/src/styles/index.css`.
- The root `package.json`: `fmt` and `fmt:check` lose `ui/src/**/*.css` except the one file, if brief 03 left the globs per-type.
- `.claude/rules/ui.md`: the Tailwind lines.
- Corpus: [wiki/decisions.md](../../wiki/decisions.md), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- `api/`, including the server-rendered OIDC pages in `api/src/oidc/layout.ts`: they carry their own inline styles and are not this stylesheet. Routes, cookies and token formats never change.
- `shared-library/`.
- The console's focus rule after a write: `ui/src/pages/console/focus-after-write.ts`, its test, and every `data-wc-focus` attribute (27 of them) stay as they are. Moving classes must not move the attribute or the element it sits on.
- `docs/`.
- Behaviour and copy: only classes change.

## What to do

One commit per step, straight on `main`, each with `npm run check` and `npm run build` green. Follow the skills library's `migrating-from-plain-css.md`.

1. **Before.**
   - Take Playwright screenshots, kept out of git, at 1280 and 390 px (the public pages in light), of: the sign-in page, register, verify (a valid, an expired and an empty token), account; the console login; and each console screen (accounts, an account's detail, apps, an app's detail with the OIDC client form, audit), with an `AlertDialog` open and a `Collapsible` open. Use a scratch API and database ([wiki/status.md](../../wiki/status.md) names the local Ward), not the shared container.
   - Record the four sizes in the table above, and the selector counts from a CSS parser.
   - Note every computed style the screenshots can't show: focus rings (`--ward-focus`), `:hover`, `:disabled`, and the reduced-motion rule.
2. **Tailwind and the tokens.** Add the pinned packages and the plugin, create `ui/src/styles/index.css` with `@import "tailwindcss"`, `@custom-variant dark` on `data-theme`, the `@theme` block (decision 1) and the `@layer base` block that holds the raw per-surface variables (decision 2; the public dark block may wait for step 6). Import it once, from `ui/src/main.tsx`, **before** deleting `tokens.css`; keep the other two files imported. Prove the surface mechanism before moving a rule: a throwaway `bg-ward-surface` on a `data-ward-surface="console"` element must paint the dark surface, and one outside it the light. Then delete `tokens.css`.
3. **Migrate `ward.css`, then `console.css`**, one file at a time, building after each. Move each rule to utilities on the JSX; state attributes become variants (`data-[tone=danger]:`); the data-built classes become lookup maps with whole class strings so the scanner sees them. What stays as CSS, each with a comment saying why: the element defaults and the body paint (`body:has([data-ward-surface="console"])`), and the reduced-motion rule. `motion-safe:` replaces the transitions where the rule can be a variant; the two `!important` stay in the one place that needs them. The Base UI parts are styled from their own wrappers by state attribute, never by a class selector aimed at them (rule 4).
4. **Measure again.**
   - Rebuild and record the four sizes. Apply decision 3's split if the sign-in pages' gzipped CSS is past about 5 kB, or if the entry JS moved at all.
   - Run brief 04's sourcemap check: the entry chunk still lists no `@base-ui` source.
5. **After.** Take the same screenshots and compare. Fix any difference a person would see in layout or colour, and let a few pixels of drift go (decision 4). Run `check-base-ui` strict, then drop its `--warn-only`.
6. **The theme switch** (decision 2), in its own commit after the screenshots:
   1. `ui/src/theme.ts` reads the stored choice (`light`, `dark` or `system`, from `localStorage` inside a `try`, since storage can be blocked) and sets `data-theme` on `<html>`; the public dark values go in `@layer base` under `[data-theme="dark"]`.
   2. A small inline script in `ui/index.html`'s `<head>` does the same before first paint: the stored choice, else `light`. With `system` it follows `prefers-color-scheme` and listens for changes, and `color-scheme` follows the theme. It touches no cookie and no request.
   3. A Light / Dark / System radio group on the account page, native and styled, in the public stylesheet (no Base UI on a sign-in page).
   4. Tests: each stored value maps to the attribute; `system` follows a changed media query; the control is found by role; a `data-ward-surface="console"` element keeps the console palette under `data-theme="dark"` and under `light`.
   5. Take dark screenshots of the sign-in, register, verify and account pages and read them for unreadable text.
7. **Corpus.** Revise "The console's widgets are Base UI; the public pages import none" in [wiki/decisions.md](../../wiki/decisions.md) (decision 5), add an entry for the two-surface mechanism and the theme switch (`@theme inline` over per-surface variables; the public pages follow Light / Dark / System, light first, on `data-theme`; the console is a surface, not a theme), update `.claude/rules/ui.md`, [wiki/status.md](../../wiki/status.md) and [log.md](../../log.md), and run `bash corpus/lint.sh` until it is clean.

## Acceptance

- [ ] `find ui/src -name '*.css'` prints `ui/src/styles/index.css` only, or with decision 3's second stylesheet listed in `scripts/conventions.json` and the outcome note; `check-base-ui` passes strict.
- [ ] `grep -rn "style={{" ui/src` prints nothing, and `grep -rn 'className={`' ui/src` prints nothing.
- [ ] `npm run check` and `npm run build -w @ward/ui` pass.
- [ ] The entry chunk's sourcemap still lists no Base UI source (brief 04's command prints `0`), and the console chunk's prints a positive number.
- [ ] The sign-in CSS and JS sizes before and after are in the outcome note; the gzipped CSS the sign-in pages download is under about 5 kB, or decision 3's split is applied.
- [ ] The screenshots at 1280 and 390 px are compared and show no visible change to layout or colour.
- [ ] The public switch has three choices. A first visit with no stored choice is light even when the system is dark; "Dark" and "System" (with a dark system) set `data-theme="dark"` before first paint, with no flash; the choice survives a reload. A Playwright test covers all three, and the console stays on its own dark surface in each. `grep -rn "prefers-color-scheme" ui/src ui/index.html` finds only the "System" code and the theme script. No cookie, route or request is added.
- [ ] With the console open, the dialog (portalled, so outside the wrapper) renders the dark surface, checked in the screenshot.
- [ ] `git diff HEAD~N -- ui/src/pages/console/focus-after-write.ts` is empty and `grep -rc "data-wc-focus" ui/src` still totals 27.
- [ ] The decision revisit and the `log.md` entry are done, and `bash corpus/lint.sh` ends clean.

## Interplay

- Brief 04 must be done first: this brief styles `Confirm` and `Collapsible` where they now live.
- The server-rendered OIDC pages (`api/src/oidc/layout.ts`) share the look of the sign-in pages but not the stylesheet. After this migration the two can drift; record that in the outcome note rather than reaching into `api/`.
- The skills library's brief 25 (the security audit) runs on ward-auth first, by the owner's answer of 2026-11-10 (Q34): one focused run of about an hour on the login, session and token code, and its findings become ward-auth briefs. It reads `ui/` and the OIDC pages; a class-name change is invisible to it, but the moved files are not.
- Brief 07 (the redesign) comes after this brief, changes values and layout on top of it, and must keep the switch working on the public pages and the console on its own surface.
