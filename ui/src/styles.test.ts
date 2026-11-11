import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * jsdom does not run the cascade, so the two-surface mechanism is checked on the source: the console block must
 * come after the public dark block and redeclare every colour the dark block does. A variable the console left out
 * would inherit the public theme's value from <html data-theme>, and the console would stop being its own dark
 * surface.
 */
const css = readFileSync(new URL("./styles/index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector: string): { start: number; names: string[] } {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  const names = [...css.slice(start, end).matchAll(/(--ward-[a-z-]+):/g)].map((match) => match[1] ?? "");
  return { start, names };
}

describe("the surfaces", () => {
  const light = block(":root");
  const dark = block(':root[data-theme="dark"]');
  const consoleSurface = block('[data-ward-surface="console"]');

  it("declares the same colours for the light and the dark public theme", () => {
    const colours = (names: string[]) => names.filter((name) => name !== "--ward-max-width").sort();
    expect(colours(dark.names)).toEqual(colours(light.names));
  });

  it("puts the console block after the public dark block", () => {
    expect(consoleSurface.start).toBeGreaterThan(dark.start);
  });

  it("has the console redeclare every colour the dark theme does", () => {
    for (const name of dark.names) expect(consoleSurface.names, name).toContain(name);
  });
});

describe("the sign-in pages' dark theme", () => {
  it("is keyed off data-theme, and the system is read only by the theme code", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toMatch(/@custom-variant dark \(&:where\(\[data-theme="dark"\]/);
  });
});
