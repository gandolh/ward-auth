import type { Page } from "@playwright/test";

import { stubWard } from "./fixtures";
import type { Screen } from "./screens";

/** Opens a screen with its stub and a stored theme (none for a first visit), then reaches its state. */
export async function open(page: Page, screen: Screen, theme?: "light" | "dark" | "system"): Promise<void> {
  if (theme !== undefined) {
    await page.addInitScript((value) => {
      localStorage.setItem("theme", value);
    }, theme);
  }
  await stubWard(page, screen.stub);
  await page.goto(screen.path);
  await page.waitForLoadState("networkidle");
  await page.locator("h1").first().waitFor();
  await screen.act?.(page);
}
