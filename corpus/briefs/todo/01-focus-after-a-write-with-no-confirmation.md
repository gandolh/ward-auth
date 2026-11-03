# Brief 01 — Focus after a console write with no confirmation

## Context

Captured 2026-10-27, after the fix for focus after a confirmed write. That
fix covers writes behind a `Confirm`: each button has a `data-wc-focus`
key, the write calls `requestFocus(key)` before the reload, and the screen
settles it (`ui/src/pages/console/focus-after-write.ts`).

The writes with no `Confirm` still drop focus to `<body>`: removing one role
(the `×` on a role), adding a role, saving an app's display name, and saving
its OIDC client. Each reloads the screen, which remounts the body, so the
button that was pressed is gone.

The owner decided on 2026-11-03: after a role is removed, focus goes to the
Access panel's heading (`AccountDetail.tsx`, the panel titled "Access"),
not the page's heading. Promoted from the todo
`focus-after-an-unconfirmed-write`.

## Files you OWN

- `ui/src/pages/console/AccountDetail.tsx` (role add and remove)
- `ui/src/pages/console/AppDetail.tsx` (display name and OIDC client saves)
- `ui/src/pages/console/focus-after-write.ts`, if the panel heading needs a
  key of its own
- the tests of those files

## Files you must NOT touch

- The confirmed writes' focus keys, which work.

## What to do

1. Adding a role: the add button gets a `data-wc-focus` key and the write
   calls `requestFocus` before the reload, so focus comes back to it.
2. Removing a role: focus goes to the Access panel's heading after the
   reload, since the `×` that was pressed is gone. Give the heading a key
   (and `tabIndex={-1}` if it isn't focusable).
3. Saving an app's display name and saving its OIDC client: focus comes back
   to each save button.
4. Keep the pattern the confirmed writes use; no second mechanism.

## Acceptance

- Tests: after each of the four writes, `document.activeElement` is the
  element above (the add button, the Access heading, each save button), not
  `<body>`.
- A short keyboard walk in the console confirms each.
- Typecheck, lint and the console's tests pass.
