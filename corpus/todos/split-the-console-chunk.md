# Split the console into its own chunk

**Promoted 2026-10-23** into [brief 34](../briefs/todo/34-console-in-its-own-chunk.md).
Delete this todo when 34 lands.

Captured 2026-10-23 from brief 33.

The UI builds to a single JS chunk, so the public sign-in, registration,
verification and account pages download the whole console with them, Base UI
included (about 22 kB gzip of the 120 kB). A lazy route for `/console`
(`React.lazy` around the console's routes in `ui/src/pages/console/routes.tsx`)
would keep the public pages' bundle to what they use.

Check afterwards with `grep -l base-ui ui/dist/assets/*.js`: only the
console's chunk should match.
