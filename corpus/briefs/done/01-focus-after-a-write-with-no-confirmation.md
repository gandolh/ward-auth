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

## Outcome (2026-11-04)

Built. Each of the four writes now asks for focus before its reload, through
the same `requestFocus` / `settle` the confirmed writes use. No second
mechanism.

| Write | Focus lands on |
|---|---|
| Remove a role (`×`) | the Access panel's heading |
| Add a role | the Access panel's heading |
| Save an app's display name | the page's heading, which shows the new name |
| Save the OIDC client settings | Save client settings |

Where the brief and the code disagreed, the code won:

- **Add role and Save the name can't take focus after the reload.** The reload
  remounts the body. The add form comes back with no app and no role, so Add
  role is disabled. The name field comes back holding the saved name, so Save
  the name is disabled. A disabled button can't take focus. Add role asks for
  the Access heading directly, because asking for the button would always fall
  to the page heading, which the owner turned down for removing a role in the
  same panel. Save the name keys its button and falls to the page heading,
  the same as Rename on the account page. The owner may still want either
  button kept enabled; that would change the console's disable-until-valid
  forms, which this brief didn't.
- **The OIDC save is in `OidcClient.tsx`**, not `AppDetail.tsx`. The panel
  takes a `requestFocus` prop, as `SessionsPanel` does.
- **`Panel` couldn't carry a key.** It renders its own `h2` in `ui.tsx`, so it
  gained an optional `focusKey`, which gives the heading the key and
  `tabIndex={-1}`.
- **No `document.activeElement` test.** The repo has no DOM environment
  (`vitest.config.ts` says why), so the tests are pure, as the confirmed
  writes' are: the rule picks the right target for each write, and `Panel`
  renders the keyed heading (`renderToStaticMarkup`). `document.activeElement`
  was checked in the browser instead.

Checked: the UI typecheck, eslint over the console, and the console's 53
tests pass. Keyboard walk in Chromium against a scratch API with a throwaway
database and console login (the dev UI on 5174, the API on 8791, not the
shared container): Enter on a role's `×`, Enter on Add role, Enter on Save
the name, Enter on Save client settings. `document.activeElement` was the
Access `h2`, the Access `h2` (Add role disabled after the reload), the `h1`
reading the new name (Save the name disabled), and the reloaded Save client
settings button. One Tab from the Access heading reached the first role's
`×`.
