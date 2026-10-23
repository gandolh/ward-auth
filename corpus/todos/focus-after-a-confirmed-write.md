# Focus after a confirmed write lands on the page body

Captured 2026-10-23 from brief 33.

When a console `Confirm` is confirmed, the confirm button disables itself
while busy, so the browser drops focus to `<body>`. When the write finishes
the dialog closes and the page reloads its data, so focus stays on `<body>`.
A keyboard user then starts again from the top of the page. Cancel and Escape
are fine: focus returns to the button that opened the dialog.

This predates Base UI (the native `<dialog>` did the same). The fix is
probably for each screen to move focus after the reload, to the outcome's
live region or to the button that opened the dialog. `Confirm`'s
`finalFocus` alone may not be enough if the reload replaces the target; check
that first.
