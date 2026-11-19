import { describe, expect, it } from "vitest";

import { plainPage } from "./provider.js";

describe("plainPage", () => {
  it("follows the saved theme and suffixes the document title", () => {
    const html = plainPage("Signed out", "<p>You are signed out of Ward.</p>");
    expect(html).toContain("<title>Signed out · Ward</title>");
    expect(html).toContain('localStorage.getItem("theme")');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain("<h1>Signed out</h1>\n  <p>You are signed out of Ward.</p>");
  });

  it("escapes the title", () => {
    const html = plainPage('<script>alert("x")</script>', "<p>Body</p>");
    expect(html).toContain("<h1>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</h1>");
    expect(html).not.toContain('<script>alert("x")');
  });
});
