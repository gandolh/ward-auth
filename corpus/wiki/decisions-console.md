---
summary: The locked calls about the console's UI — Tailwind, the console as a dark surface and not a theme, the public pages' Light / Dark / System switch, Base UI for the console's widgets and none on the sign-in pages, where the wrappers live (pages/console/ui), the native selects, datalist and textareas kept, the sign-in pages as the rule 13 exception, and Confirm's focus order (Cancel first).
updated: 2026-11-11
---

# Decisions — the console's UI

Foundational calls live in [decisions.md](./decisions.md). Same rule: do not
reopen one without an explicit revisit and a [../log.md](../log.md) entry.

## The console's widgets are Base UI; the public pages import none
_2026-10-23, owner_ — The console's confirmation is a Base UI
`AlertDialog` and its create forms are `Collapsible`s, styled by `console.css`,
to match the owner's other apps. Rejected: keeping the native `<dialog>` with
its own wiring, and shadcn. **Revised 2026-11-11** (the owner's call of
2026-11-09 that whole apps move to Tailwind): the console is styled with
Tailwind utilities, and "shadcn brings Tailwind" no longer counts against
anything. shadcn stays rejected for its own reason: Base UI is used directly,
without a styled kit on top. Only `ui/src/pages/console/`
imports it, and since 2026-10-27 the console is a lazy chunk, so the sign-in
pages download none of it. After a confirmed write focus goes to the opener,
found again by its `data-wc-focus` key, or else to the heading (2026-10-27):
`finalFocus` can't do it, because the reload removes the opener. Writes with no
confirmation use the same rule (2026-11-04), and a role added or removed lands
on the Access panel's heading (owner, 2026-11-03).

**Where the wrappers live (2026-11-11, technical call).** Base UI is imported
only under the console's own `ui/src/pages/console/ui/`, one file per
primitive: `Confirm.tsx` and `Collapsible.tsx`, named exports. Not under
`ui/src/components/ui/`: that folder sits beside the sign-in pages' `Field` and
`Notice`, one wrong import from a page that must download none of it. The
folder is named in `scripts/conventions.json` (`"ui"`), so `check-base-ui`
rule 3 allows it there and nowhere else. The sign-in pages are the rule 13
exception: their hand-built fields stay, because Base UI's `Field` would put
its JavaScript on the page every app sends people to. The entry chunk's
sourcemap listing no `@base-ui` source (the lazy console chunk lists 103) is
the proof, and the check to rerun after any import change.

**Native controls kept (2026-11-11, technical call).** The four `<select>`s
(the audit filters, the grant form's app) are plain fields in forms that an
Apply or submit button commits, with a handful of options and no custom
rendering, so the `RadioGroup` rule for a live filter doesn't apply. The role
suggestions stay a `<datalist>` on a free-text field: a native text input with
suggestions, not a `Combobox`. The three `textarea`s are text input. Moving any
of them is a new brief that re-measures the console chunk.

**Confirm's focus order (2026-11-11).** Cancel first, which is what Base UI's
`AlertDialog` does by default and what the base-ui skill's confirm pattern
sets with `initialFocus`: a destructive confirm never defaults to its action.
`Confirm.test.tsx` holds it, with the busy guard, under `jsdom` (a docblock per
test file; the root project stays in Node).

## Two surfaces, and a theme switch for the public pages
_2026-11-11, owner (switch, console dark-only) and technical call (mechanism)_ —
The UI is Tailwind 4.3.5, with Ward's token names kept 1:1
(`--ward-<name>` is `ward-<name>` in `bg-`, `text-`, `border-`, `shadow-`).
Two stylesheets: `ui/src/styles/index.css` (the sign-in pages; 4.6 kB gzip) and
`ui/src/pages/console/console.css` (utilities only, loaded by the lazy console
chunk), sharing `styles/theme.css`; `scripts/conventions.json` records both as
rule 5 exceptions. The raw `--ward-*` colours stay variables in `@layer base`
and `@theme inline` maps the utility names onto them, so a re-pointed variable
reaches every utility. **The console is a surface, not a theme:**
`[data-ward-surface="console"]` re-declares the whole palette on its own element
(and on the portalled dialog's popup), so it stays dark whatever `data-theme` says
on `<html>`, and `styles.test.ts` fails if the console block stops covering the
public dark block. **The public pages follow Light / Dark / System**, light on a
first visit even when the system is dark, on `data-theme` (always the resolved
`light` or `dark`). The choice is in `localStorage` only; the control is a native
radio group on the account page (no Base UI on a sign-in page); no cookie, route
or request. `ui/index.html` carries a small inline boot script. Ward's CSP sets no
`script-src`, so it runs; **a future `script-src` (the security audit may add one)
needs this script's hash, or the script moved to a file.**

