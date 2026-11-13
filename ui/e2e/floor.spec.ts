import { expect, test } from "@playwright/test";

import { open } from "./open";
import { SCREENS } from "./screens";

/*
 * The Floor, screen by screen: every keyboard stop shows a visible focus ring, nothing moves under reduced motion,
 * and a 390 px phone never scrolls sideways, in both public themes.
 */
for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test("every Tab stop shows a visible focus ring", async ({ page }) => {
      await open(page, screen);
      let stops = 0;
      for (let step = 0; step < 80; step += 1) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const element = document.activeElement;
          if (element === null || element === document.body) return null;
          if (element.hasAttribute("data-visited")) return "again" as const;
          element.setAttribute("data-visited", "");
          // The Theme radios are invisible and cover their segment, so the ring is drawn on the segment beside them.
          const drawn = getComputedStyle(element).opacity === "0" ? (element.nextElementSibling ?? element) : element;
          const style = getComputedStyle(drawn);
          const label = `${element.tagName} ${element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)}`;
          return { label, style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
        });
        if (stop === "again") break;
        if (stop === null) continue;
        stops += 1;
        expect(stop.style, `${stop.label} has an outline`).not.toBe("none");
        expect(stop.width, `${stop.label} outline width`).toBeGreaterThanOrEqual(2);
        expect(stop.color, `${stop.label} outline colour`).not.toBe("rgba(0, 0, 0, 0)");
      }
      expect(stops, "the screen has keyboard stops").toBeGreaterThan(0);
    });

    test("nothing runs under reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, screen);
      const moving = await page.evaluate(() => {
        // The reduced-motion rule leaves 0.01 ms, which no eye sees: anything up to a millisecond counts as still.
        const seconds = (value: string): number =>
          value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
        const running = document.getAnimations().filter((animation) => animation.playState === "running");
        const timed = [...document.querySelectorAll("*")].filter((element) => {
          const style = getComputedStyle(element);
          const transition = style.transitionDuration.split(",").some((value) => seconds(value.trim()) > 0.001);
          const animation =
            style.animationName !== "none" &&
            style.animationDuration.split(",").some((value) => seconds(value.trim()) > 0.001);
          return transition || animation;
        });
        return { running: running.length, timed: timed.map((element) => element.tagName).slice(0, 5) };
      });
      expect(moving).toEqual({ running: 0, timed: [] });
    });

    for (const theme of screen.console === true ? (["dark"] as const) : (["light", "dark"] as const)) {
      test(`390 px has no sideways scroll, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, screen, theme);
        const widths = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
      });
    }
  });
}
