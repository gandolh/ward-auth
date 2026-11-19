import { describe, expect, it } from "vitest";

import { pageShell } from "./page-shell.js";

describe("pageShell", () => {
  const html = pageShell({ title: "A <b>title</b>", body: "<p>Body</p>" });

  it("carries the boot script, the color-scheme meta and both palettes", () => {
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('localStorage.getItem("theme")');
    expect(html).toContain('saved === "dark" || saved === "system"');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("document.documentElement.dataset.theme");
    expect(html).toContain("--ward-bg:#e9e8e1");
    expect(html).toContain(':root[data-theme="dark"]{color-scheme:dark;--ward-bg:#121412');
  });

  it("sets the theme before the stylesheet and the body", () => {
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<style>"));
    expect(html.indexOf("<style>")).toBeLessThan(html.indexOf("<body>"));
  });

  it("escapes the title, in the heading and the document title", () => {
    expect(html).not.toContain("<b>title</b>");
    expect(html).toContain("<h1>A &lt;b&gt;title&lt;/b&gt;</h1>");
    expect(html).toContain("<title>A &lt;b&gt;title&lt;/b&gt;</title>");
  });

  it("puts the body under the heading as given", () => {
    expect(html).toContain("<h1>A &lt;b&gt;title&lt;/b&gt;</h1>\n  <p>Body</p>");
  });

  it("uses a separate document title when given one, escaped", () => {
    const page = pageShell({ title: "Signed out", documentTitle: "Signed out · <Ward>", body: "" });
    expect(page).toContain("<title>Signed out · &lt;Ward&gt;</title>");
    expect(page).toContain("<h1>Signed out</h1>");
  });
});
