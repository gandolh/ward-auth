---
summary: The locked calls about the console's UI library — Base UI for the console's widgets and none on the sign-in pages, where the wrappers live (pages/console/ui), the native selects, datalist and textareas kept, the sign-in pages as the rule 13 exception, and Confirm's focus order (Cancel first).
updated: 2026-11-11
---

# Decisions — the console's UI

Foundational calls live in [decisions.md](./decisions.md). Same rule: do not
reopen one without an explicit revisit and a [../log.md](../log.md) entry.

## The console's widgets are Base UI; the public pages import none
_2026-10-23, owner_ — The console's confirmation is a Base UI
`AlertDialog` and its create forms are `Collapsible`s, styled by `console.css`,
to match the owner's other apps. Rejected: keeping the native `<dialog>` with
its own wiring, and shadcn, which brings Tailwind. Only `ui/src/pages/console/`
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
