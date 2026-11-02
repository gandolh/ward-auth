# Focus after a console write that has no confirmation

Captured 2026-10-27, after the fix for focus after a confirmed write.

That fix covers writes behind a `Confirm`. The writes with no `Confirm` still
drop focus to `<body>`: removing one role (the `×` on a role), adding a role,
saving an app's display name, and saving its OIDC client. Each reloads the
screen, which remounts the body, so the button that was pressed is gone.

The fix is the same: give each button a `data-wc-focus` key, call
`requestFocus(key)` before the reload, and let the screen settle it
(`ui/src/pages/console/focus-after-write.ts`). The role `×` needs a key per app
and role. Once the role is gone the heading takes focus, which may be the wrong
place for a one-click change; the Access panel's heading could be the target.
