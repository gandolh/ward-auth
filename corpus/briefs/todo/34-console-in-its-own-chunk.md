# Task 34: The console in its own chunk

## Context

Promoted 2026-10-23 from the todo
[split-the-console-chunk](../../todos/split-the-console-chunk.md), captured from
[brief 33](../done/33-base-ui-in-the-console.md).

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
