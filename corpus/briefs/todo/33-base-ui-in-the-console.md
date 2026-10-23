# Task 33: Base UI for the console's confirmation and disclosures

## Context

On 2026-10-23 the owner asked for Base UI (`@base-ui/react`) in the apps that
still hand-build their interactive widgets, to match their other apps
(atrium, imbatranimOS, sports-app, trips, ro-housing, public-resource-map,
newspapper). Base UI is headless: it supplies focus handling, keyboard
behaviour and ARIA, and Ward keeps `tokens.css`, `ward.css` and
`console.css`.

Ward's UI has very few widgets. The only interactive pieces in
`ui/src/pages/console/` are:

- `ui.tsx` `Confirm`: the destructive confirmation, used about ten times
  across Accounts, AccountDetail, Apps and AppDetail. It is a native
  `<dialog>` with `showModal()`. Its header comment gives the reason: the
  focus trap and Escape should be "the browser's problem rather than ours".
  Base UI keeps that property (it is a maintained library's problem, not
  Ward's), and it must keep the two rules the comment lists:
  - Escape goes through the same path as Cancel;
  - a busy dialog can't be dismissed while its request is in flight.
- The "New account" / "New app" disclosures in `Accounts.tsx` and
  `Apps.tsx`: a button with `aria-expanded` that shows the create form.

The sign-in, registration, verification and account pages (`ui/src/pages/*.tsx`)
have no widgets and must not import Base UI. Their bundle stays as it is.

## Files you OWN

```
ui/src/pages/console/{ui,Accounts,Apps}.tsx  ui/src/pages/console/console.css
ui/package.json (dependencies only)  package-lock.json
corpus/wiki/{decisions,status}.md
```

## Files you must NOT touch

`api/`, `shared-library/`, `ui/src/pages/{Login,Register,Verify,Account}.tsx`,
`ui/src/components/**`, `ui/src/lib/**`, `ui/src/ward.css`, `ui/src/tokens.css`.

## What to do

1. Add `"@base-ui/react": "1.9.0"` to `ui/package.json` dependencies,
   pinned exactly like the rest, then run `npm install` from the root.
2. **`Confirm` → Base UI `AlertDialog`.** Keep `ConfirmProps` and every call
   site unchanged. `open` drives `AlertDialog.Root`. `onOpenChange(false)`
   calls `onCancel` only when `busy !== true`, and while busy it is ignored,
   so neither Escape nor a click can dismiss mid-request. `AlertDialog.Title`
   is the `<h2>`. The `tone` and the busy label stay. Rewrite the header
   comment's dialog bullet to say what holds now and why.
3. **Disclosures → `Collapsible`** in `Accounts.tsx` and `Apps.tsx`, driven
   by the existing `creating` state. Keep the button's changing label.
4. **Styles.** Move `.wc-dialog` and `::backdrop` onto the `Popup` and
   `Backdrop` classes in `console.css`. Keep the look the same.
5. The audit filters and the role `<select>` in AccountDetail stay native,
   and so does the checkbox in Apps.
6. Add a `decisions.md` entry: Base UI in the console only, dated
   2026-10-23, the owner's call to match their other apps. Rejected: keeping
   the native `<dialog>`, and shadcn (it brings Tailwind). The public sign-in
   pages stay free of it. Update `status.md`.

## Acceptance

- `npm run typecheck && npm run lint && npm run test && npm run build` pass.
- The built sign-in page's chunk does not contain Base UI. Check with
  `grep -l base-ui ui/dist/assets/*.js` against which chunk each page
  loads. If the console isn't code-split from the public pages, say so in
  the outcome note rather than adding splitting here.
- Browser check against the local Ward container, signed in to the console
  as an admin:
  - **revoke** an app grant: the dialog takes focus, Tab stays inside,
    Escape cancels, and focus returns;
  - while the request is in flight, Escape and Cancel do nothing;
  - **New account** opens and closes the form.
  Take before/after screenshots at 1440 px and 390 px.
- `bash corpus/lint.sh` passes.
