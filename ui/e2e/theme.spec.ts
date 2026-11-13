import { expect, test, type Page } from "@playwright/test";

import { stubWard } from "./fixtures";

/*
 * The Light / Dark / System switch: light on a first visit even when the system is dark, each stored choice in force
 * before the page draws, the choice kept across a reload, and the console on its own dark surface under each.
 */
const CONSOLE_GROUND = "rgb(24, 26, 28)";

async function themeOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset["theme"]);
}

test("a first visit is light, even when the system is dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubWard(page, { signedIn: true });
  await page.goto("/account");
  expect(await themeOf(page)).toBe("light");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});

for (const [stored, system, expected] of [
  ["dark", "light", "dark"],
  ["system", "dark", "dark"],
  ["system", "light", "light"],
  ["light", "dark", "light"],
] as const) {
  test(`${stored} with a ${system} system draws ${expected} from the first paint`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript((value) => {
      localStorage.setItem("theme", value);
    }, stored);
    await stubWard(page, {});
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(await themeOf(page)).toBe(expected);
  });
}

test("the choice is made on the account page and survives a reload", async ({ page }) => {
  await stubWard(page, { signedIn: true });
  await page.goto("/account");
  await page.getByRole("radio", { name: "Dark" }).check();
  expect(await themeOf(page)).toBe("dark");
  await page.reload();
  await page.getByRole("radio", { name: "Dark" }).waitFor();
  expect(await themeOf(page)).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});

for (const stored of ["light", "dark", "system"] as const) {
  test(`the console keeps its own surface under ${stored}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("theme", value);
    }, stored);
    await stubWard(page, { console: true });
    await page.goto("/console/accounts");
    await page.getByRole("heading", { name: "Accounts" }).waitFor();
    const grounds = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      token: getComputedStyle(document.querySelector('[data-ward-surface="console"]') ?? document.body)
        .getPropertyValue("--ward-bg")
        .trim(),
    }));
    expect(grounds).toEqual({ body: CONSOLE_GROUND, token: "#181a1c" });
  });
}
