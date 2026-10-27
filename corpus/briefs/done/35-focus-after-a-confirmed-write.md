# Task 35: Focus after a confirmed write

## Context

Promoted 2026-10-23 from the todo
`focus-after-a-confirmed-write` (deleted when this brief landed),
captured from [brief 33](33-base-ui-in-the-console.md).

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

## Outcome (2026-10-27)

**Step 1, `finalFocus`: not enough.** Checked in Chromium with `finalFocus` as
a function that logged the opener. Base UI calls it once, in the commit that
closes the dialog. `finish()` closes the dialog and reloads in the same batch,
and the reload sets the screen's loadable to "loading", which unmounts the
whole body. So when `finalFocus` runs the opener is already disconnected
(`isConnected: false`) and the reloaded body doesn't exist yet. Focus ended on
`<body>`. Base UI's fallback is the opener of an earlier dialog, if one is still
connected, which would be worse than `<body>`.

**The rule** (`ui/src/pages/console/focus-after-write.ts`): before the reload,
the screen asks for focus by the opener's `data-wc-focus` key; once the reload
is on screen it focuses that opener if it is there and enabled, else the
screen's `h1` (now `tabIndex={-1}`). The request lives in the screen component,
above the body the reload remounts. Disable/Re-enable and Open/Close
registration share a key, so each lands on its counterpart. Rename and Rotate
land on the heading, since their buttons are disabled after the reload, and so
do revoke-app, end-session and end-all, whose buttons are gone. Keys that could
repeat on a screen carry their slug or family id, so revoking atrium never
lands on satchel's revoke. A deleted account or app is the exception: the
screen becomes its outcome alert, which already takes focus.

**`Confirm`**: the confirm button focuses the popup before calling `onConfirm`,
so focus never falls to `<body>` mid-request, and `finalFocus` is `false` after
a confirm, so Base UI's fallback can't run. Cancel and Escape keep the default
and return to the opener.

There are twelve `Confirm` call sites, not ten: briefs 39-40 added rename and
delete on the account page. All twelve follow the rule. The brief's "app's key
rotation" no longer exists (app keys went with brief 30), so open and close
registration stood in for it. The rule is in a new file beside `nav.ts`, which
isn't on the brief's OWN list, so that `focus-after-write.test.ts` could pin it
without a DOM (7 tests).

Checked in Chromium, keyboard only (Enter, Tab, Enter) against a scratch API,
with writes delayed 800 ms to catch the busy state. While busy, focus was on
the `alertdialog` popup with the confirm button disabled. After the write:

| Write | Focus |
|---|---|
| Disable / Re-enable | the counterpart button |
| Revoke all access to atrium (satchel left) | `h1` |
| Rename / Rotate password | `h1` |
| End this session (one of three) / End all | `h1` |
| Delete account / Remove app | the outcome alert |
| Open registration | Close registration |
| Close registration | `h1` |
| Register an app open to strangers | the Apps `h1` |

Cancel and Escape returned focus to the opener. A failed confirmed write
(rename to a taken name, `409`) left focus on the error alert. Typecheck, lint,
the build and 1203 tests pass.

Writes without a `Confirm` drop focus the same way: removing one role, adding a
role, saving an app's name or its OIDC client. The reload remounts the body
there too. Filed as
[focus-after-an-unconfirmed-write.md](../../todos/focus-after-an-unconfirmed-write.md).

brief-board is down, so nothing was posted there.
