import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { open } from "./open";
import { DRAWN, SCREENS } from "./screens";

/*
 * Screenshots for comparing the build with the board's comps, written outside the repo:
 * `SHOTS_DIR=<dir> npx playwright test shots --workers=2`. Without SHOTS_DIR the spec is skipped. Each drawn
 * screen at 1280x800 and 390x844 in both themes, every other screen once per width; `<screen>-<theme>-<width>.png`.
 * It also measures what the board's rulings name: the reach heading's y on the phone, and the folds.
 */
const dir = process.env["SHOTS_DIR"];

test.skip(dir === undefined, "SHOTS_DIR is not set");

const SIZES = [
  [1280, 800],
  [390, 844],
] as const;

for (const screen of SCREENS) {
  const themes =
    DRAWN.includes(screen.name) && screen.console !== true ? (["light", "dark"] as const) : (["light"] as const);
  for (const [width, height] of SIZES) {
    for (const theme of themes) {
      test(`${screen.name} ${theme} ${String(width)}`, async ({ page }) => {
        mkdirSync(dir ?? "", { recursive: true });
        await page.setViewportSize({ width, height });
        await open(page, screen, theme);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.screenshot({
          path: join(dir ?? "", `${screen.name}-${screen.console === true ? "console" : theme}-${String(width)}.png`),
          fullPage: screen.windowShot !== true,
        });
      });
    }
  }
}

test("the reach heading and the Password heading on a phone's first screen", async ({ page }) => {
  const screen = SCREENS.find((entry) => entry.name === "account");
  if (screen === undefined) throw new Error("no account screen");
  const report: string[] = [];
  for (const [width, height] of [
    [390, 844],
    [360, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, screen, "light");
    const reach = await page.getByRole("heading", { name: "What you can reach" }).boundingBox();
    const password = await page.getByRole("heading", { name: "Password" }).boundingBox();
    report.push(
      `${String(width)}x${String(height)}: reach heading y ${String(Math.round(reach?.y ?? -1))}, Password heading y ${String(Math.round(password?.y ?? -1))} (${(password?.y ?? Infinity) + (password?.height ?? 0) <= height ? "shows" : "below the fold"})`,
    );
  }
  test.info().annotations.push({ type: "first screen", description: report.join("; ") });
  console.log(report.join("\n"));
  expect(report).toHaveLength(2);
});

test("the folds", async ({ page }) => {
  const report: string[] = [];
  const consoleScreen = SCREENS.find((entry) => entry.name === "console-accounts");
  const account = SCREENS.find((entry) => entry.name === "account");
  const signin = SCREENS.find((entry) => entry.name === "signin");
  if (consoleScreen === undefined || account === undefined || signin === undefined) throw new Error("no screen");
  for (const width of [999, 1000, 1001]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, consoleScreen);
    report.push(`console ${String(width)}: table ${(await page.locator("table").isVisible()) ? "shown" : "hidden"}`);
  }
  for (const width of [639, 640, 641, 899, 900, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, account, "light");
    const who = await page.getByRole("heading", { name: "Who you are" }).boundingBox();
    const reach = await page.getByRole("heading", { name: "What you can reach" }).boundingBox();
    const fields = await page
      .locator("#ward-new-password, #ward-confirm-password")
      .evaluateAll((inputs) => inputs.map((input) => Math.round(input.getBoundingClientRect().top)));
    report.push(
      `account ${String(width)}: ${(reach?.x ?? 0) > (who?.x ?? 0) + 100 ? "two columns" : "one column"}, new-password fields ${fields[0] === fields[1] ? "side by side" : "stacked"}`,
    );
    await open(page, signin);
    const card = await page.locator("form").evaluate((form) => form.parentElement?.getBoundingClientRect().width ?? 0);
    report.push(`signin ${String(width)}: card ${String(Math.round(card))} px wide`);
  }
  console.log(report.join("\n"));
  expect(report.length).toBeGreaterThan(0);
});
