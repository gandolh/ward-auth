# Task 35: Focus after a confirmed write

## Context

Promoted 2026-10-23 from the todo
[focus-after-a-confirmed-write](../../todos/focus-after-a-confirmed-write.md),
captured from [brief 33](../done/33-base-ui-in-the-console.md).

When a console `Confirm` is confirmed, the confirm button disables itself while
busy, so the browser drops focus to `<body>`. When the write finishes the dialog
closes and the screen reloads its data, so focus stays on `<body>`. A keyboard user
starts again from the top of the page. Cancel and Escape are fine: focus returns to
the button that opened the dialog. This predates Base UI (the native `<dialog>` did
the same).

`Confirm` is in [`ui/src/pages/console/ui.tsx:216`](../../../ui/src/pages/console/ui.tsx),
an `AlertDialog` that passes no `finalFocus` today. It is used ten times
(checked 2026-10-23): once in `Apps.tsx`, six times in `AccountDetail.tsx`, three
times in `AppDetail.tsx`. Each screen also has a live region from `useAnnounce`
in the same file, which says the outcome.

## Files you OWN

- `ui/src/pages/console/ui.tsx` (`Confirm` only)
- `ui/src/pages/console/Apps.tsx`, `AccountDetail.tsx`, `AppDetail.tsx`: the
  `Confirm` call sites and whatever each needs to hold a focus target
- A test next to the existing `console-logic.test.ts`, if the behaviour can be pinned
  without a browser

## Files you must NOT touch

- `ui/src/pages/console/routes.tsx` and the session countdown in `session.tsx`.
- The public pages outside `pages/console/`.

## What to do

1. **Check first.** Try Base UI's `finalFocus` on `AlertDialog.Popup` (see the Base UI
   migration notes in this estate: a menu item uses `finalFocus` the same way). Find
   out whether it is enough when the screen's reload replaces the element it points
   at. Write the answer in the outcome note.
2. Settle one rule for where focus goes after a confirmed write, and apply it at all
   ten call sites:
   - the action still exists after the reload (for example revoking one grant of
     several): focus the button that opened the dialog, found again after the
     reload by a stable key;
   - the thing is gone (a deleted account or app, the last grant): focus the
     screen's heading (`tabIndex={-1}`), so the live region's message is read next.
3. Make the busy state keep focus inside the dialog: move focus to the dialog's
   popup (or its title) before disabling the confirm button, so it never falls to
   `<body>` mid-request.
4. Keep Cancel and Escape returning focus to the opener, as now.

## Acceptance

- With the keyboard only, confirm each kind of write once (a grant change, a delete,
  an app's key rotation): after it lands, `document.activeElement` is the opener or
  the heading as the rule says, never `<body>`.
- Cancel and Escape still return focus to the button that opened the dialog.
- `npm run typecheck`, `npm run lint`, `npm test` pass; `npm run build` builds the UI.
