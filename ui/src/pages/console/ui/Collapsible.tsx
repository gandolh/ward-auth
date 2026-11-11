/**
 * The console's one door to Base UI's `Collapsible`. A screen imports `Root`,
 * `Trigger` and `Panel` from here, never from `@base-ui/react`: Base UI is
 * imported only under this folder, so the sign-in pages (which download none of
 * it) are one wrong import away from nothing.
 */

import { Collapsible } from "@base-ui/react/collapsible";

export const Root = Collapsible.Root;
export const Trigger = Collapsible.Trigger;
export const Panel = Collapsible.Panel;
