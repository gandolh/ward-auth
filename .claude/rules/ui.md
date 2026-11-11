---
paths:
  - "ui/src/**"
---

# The UI (`ui/src`)

- Read the `base-ui` skill before you add or change a console component.
- Base UI (`@base-ui/react`, pinned at 1.9.0) belongs to the console only,
  and only through the wrappers in `pages/console/ui/` (`Confirm.tsx`,
  `Collapsible.tsx`). No other file imports it. A new Base UI part gets a
  wrapper there, and `scripts/conventions.json` names that folder.
- The sign-in pages (`pages/Login.tsx`, `Register.tsx`, `Account.tsx`,
  `Verify.tsx`) import no Base UI, so the page every app sends people to
  downloads none. Keep it that way.
- After a console write, focus goes back to the button that opened it, found
  by its `data-wc-focus` key, or else to the screen's heading:
  `pages/console/focus-after-write.ts` has the rule. A new write button gets
  a key, and keeps it when its label changes.
- The console is its own dark surface (`data-ward-surface="console"`,
  `styles/index.css`), dark whatever the reader's colour scheme and whatever
  `data-theme` says. The public pages follow Light / Dark / System on
  `data-theme` (`theme.ts`, the boot script in `index.html`, the radio group on
  the account page); a new public colour is a `--ward-*` variable in both
  `:root` blocks, and `styles.test.ts` keeps the console block covering them.
- The styles are Tailwind 4: `styles/index.css` (the sign-in pages, plus
  `theme.css`) and `pages/console/console.css` (utilities for the lazy console
  chunk only). Write utilities on the element; a repeated look is a whole class
  string in `components/looks.ts` (sign-in, no `cn()`: tailwind-merge would join
  the entry chunk) or `pages/console/looks.ts` (console, `cn()` allowed). Class
  strings are written whole, never built from pieces. `.wc-main` on the
  console's `<main>` is a hook for `focus-after-write.ts`, not a style.
- No `window.confirm`, `alert` or `prompt`: a confirmation is the console's
  dialog.
- Tests run in Node by default (the `?next=` allowlist, the API error
  mapping, the focus rule). A wrapper that holds logic gets a jsdom test, with
  a `// @vitest-environment jsdom` docblock (`ui/Confirm.test.tsx`).
- Native selects, the role `<datalist>` and the `textarea`s stay native, by a
  recorded decision (`corpus/wiki/decisions.md`).
- `npm run check:conventions` runs `check-base-ui` over this folder,
  strict.
