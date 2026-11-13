import type { Page } from "@playwright/test";

import { ALEX, type Stub } from "./fixtures";

/** One screen of the UI: where it is, the stub it needs, and what to do to reach a state after it loads. */
export interface Screen {
  name: string;
  path: string;
  stub: Stub;
  /** The console is its own dark surface whatever the theme, so it is checked in one theme only. */
  console?: boolean;
  /** A dialog is fixed to the window, so its shot is the window, not the whole page. */
  windowShot?: boolean;
  act?: (page: Page) => Promise<void>;
}

export const SCREENS: Screen[] = [
  { name: "signin", path: "/login", stub: {} },
  { name: "register", path: "/register?app=shelfmark", stub: { openApps: true } },
  { name: "verify-valid", path: "/verify?token=valid", stub: {} },
  { name: "verify-expired", path: "/verify?token=expired", stub: {} },
  { name: "verify-empty", path: "/verify", stub: {} },
  { name: "not-found", path: "/nowhere", stub: {} },
  { name: "account", path: "/account", stub: { signedIn: true } },
  { name: "account-signed-out", path: "/account", stub: {} },
  { name: "console-signin", path: "/console", stub: {}, console: true },
  { name: "console-accounts", path: "/console/accounts", stub: { console: true }, console: true },
  {
    name: "console-new-account",
    path: "/console/accounts",
    stub: { console: true },
    console: true,
    act: async (page) => {
      await page.getByRole("button", { name: "New account" }).click();
    },
  },
  { name: "console-account", path: `/console/accounts/${ALEX}`, stub: { console: true }, console: true },
  {
    name: "console-confirm",
    path: `/console/accounts/${ALEX}`,
    stub: { console: true },
    console: true,
    act: async (page) => {
      await page.getByRole("button", { name: "Delete alex" }).click();
      await page.getByRole("alertdialog").waitFor();
    },
    windowShot: true,
  },
  { name: "console-apps", path: "/console/apps", stub: { console: true }, console: true },
  { name: "console-app", path: "/console/apps/shelfmark", stub: { console: true }, console: true },
  { name: "console-audit", path: "/console/audit", stub: { console: true }, console: true },
];

/** The board's three drawn screens. */
export const DRAWN = ["signin", "account", "console-accounts"];
