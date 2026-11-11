---
paths:
  - "ui/src/**"
---

# The UI (`ui/src`)

- Read the `base-ui` skill before you add or change a console component.
- Base UI (`@base-ui/react`, pinned at 1.9.0) belongs to the console only,
  and only through its wrappers. Today `pages/console/ui.tsx` wraps the
  alert dialog, and `Accounts.tsx` and `Apps.tsx` still import the
  collapsible directly (`check-base-ui` rule 3, a warning until the wrappers
  move into a `ui/` folder).
- The sign-in pages (`pages/Login.tsx`, `Register.tsx`, `Account.tsx`,
  `Verify.tsx`) import no Base UI, so the page every app sends people to
  downloads none. Keep it that way.
- After a console write, focus goes back to the button that opened it, found
  by its `data-wc-focus` key, or else to the screen's heading:
  `pages/console/focus-after-write.ts` has the rule. A new write button gets
  a key, and keeps it when its label changes.
- The console is its own dark surface (`data-ward-surface="console"`,
  `tokens.css`), dark whatever the reader's colour scheme. The public pages
  are light; a Light / Dark / System switch for them comes with the move to
  Tailwind.
- The styles are plain CSS on tokens today: `tokens.css`, `ward.css` and
  `pages/console/console.css`. The move to Tailwind replaces all three, so
  don't grow them; add no new stylesheet.
- No `window.confirm`, `alert` or `prompt`: a confirmation is the console's
  dialog.
- Tests are pure logic in Node (no DOM environment is configured): the
  `?next=` allowlist, the API error mapping, the focus rule.
- `npm run check:conventions` runs `check-base-ui` over this folder,
  `--warn-only` until the UI is on Tailwind.
