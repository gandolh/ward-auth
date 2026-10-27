# Task 34: The console in its own chunk

## Context

Promoted 2026-10-23 from the todo
`split-the-console-chunk` (deleted when this brief landed), captured from
[brief 33](33-base-ui-in-the-console.md).

The UI builds to a single JS chunk. The public sign-in, registration, verification
and account pages download the whole console with them, Base UI included (about
22 kB gzip of the 120 kB). [`ui/src/app.tsx:9`](../../../ui/src/app.tsx) imports
`ConsoleRoutes` from `./pages/console/routes.js` statically and mounts it under
`/console/*`. [`routes.tsx`](../../../ui/src/pages/console/routes.tsx) also imports
`./console.css`, so the console's styles ride in the same chunk.

Nothing in the UI uses `React.lazy` or `Suspense` yet (checked 2026-10-23).

## Files you OWN

- `ui/src/app.tsx`: the static import becomes a `React.lazy` import, and the
  `/console/*` element is wrapped in `Suspense`.

## Files you must NOT touch

- Everything under `ui/src/pages/console/`. The contract in `routes.tsx` is that the
  console is exported as one `<ConsoleRoutes />` element, and that does not change.
  If `React.lazy` needs a default export, wrap the named export in `app.tsx`
  (`lazy(() => import(...).then((m) => ({ default: m.ConsoleRoutes })))`).
- `ui/vite.config.ts`: no manual chunk config; the dynamic import is enough.

## What to do

1. Make the console route lazy as above.
2. Give `Suspense` a fallback that matches the console's surface (a short "Loading
   the console…" line inside the `data-ward-surface="console"` wrapper), not a
   blank page.
3. Build and check that the split happened: `grep -l base-ui ui/dist/assets/*.js`
   matches only the console's chunk, and the console's CSS is in its own file.
4. Load `/console` in the dev server and in `vite preview` with the network tab open:
   the console chunk is fetched only when `/console` is opened.

## Acceptance

- `grep -l base-ui ui/dist/assets/*.js` lists one file, and it is not the entry chunk.
- The entry chunk's gzip size drops by roughly the console's share (write the before
  and after numbers in the outcome note).
- `/login`, `/register`, `/verify` and `/account` render with no console chunk
  requested; `/console` renders as before, including a deep link like
  `/console/accounts/<id>`.
- `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.

## Outcome (2026-10-27)

Built as the brief says, in `app.tsx` only: `ConsoleRoutes` comes from a
`React.lazy` import that wraps the named export, and the `/console/*` element
puts `Suspense` inside the existing `data-ward-surface="console"` wrapper.

The fallback can't use the console's `wc-*` classes: `console.css` arrives with
the console chunk, so none of them are styled while it loads. It is a
`.ward-lede` line from `ward.css`, which is in the entry and reads the tokens,
so inside the wrapper it renders in the dark palette, and `tokens.css` paints
the body dark through `body:has(...)`. It has `role="status"`.

| | Before | After |
|---|---|---|
| Entry JS | 390.07 kB (120.07 kB gzip) | 257.22 kB (81.45 kB gzip) |
| Console JS | in the entry | 134.63 kB (40.30 kB gzip) |
| Entry CSS | 19.95 kB (3.99 kB gzip) | 7.89 kB (2.14 kB gzip) |
| Console CSS | in the entry | 12.06 kB (2.37 kB gzip) |

The console's share is about 40 kB gzip, not the 22 kB the brief estimated:
that figure was Base UI alone, and the chunk also holds the console's own
screens.

Checked: `grep -l base-ui ui/dist/assets/*.js` lists only `routes-*.js`, and
no console string (`wc-hazard`, `Break-glass`) is in the entry. In Chromium
against a scratch API on a temporary database, through `vite preview`,
`/login`, `/register`, `/verify` and `/account` each loaded only the entry JS
and CSS. A deep link to `/console/accounts/<subject>` fetched the console's JS
and CSS, showed the loading line on the dark ground, then rendered the account
signed in, and the console gate signed out. The dev server gave the same
result: no `pages/console` module on `/login`, and the console modules on the
deep link. Typecheck, lint, `npm run build` and the 1196 tests pass.
`fmt:check` flags `README.md` and `ui/src/lib/next.test.ts`, which this brief
didn't touch.

No error boundary was added for a failed chunk load. No public page links into
`/console`, so the chunk is only fetched by a full page load of `/console`,
which also fetches a fresh `index.html` with the chunk's current name.

brief-board is down, so nothing was posted there.
