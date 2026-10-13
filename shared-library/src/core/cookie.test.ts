import { describe, expect, it } from "vitest";

import { clearedCookie, readCookie, secureCookiesFor, serializeCookie } from "./cookie.js";

describe("serializeCookie", () => {
  it("always emits HttpOnly and SameSite=Lax, with the path given", () => {
    expect(
      serializeCookie({
        name: "atrium_session",
        value: "abc",
        path: "/atrium/api",
        maxAgeSeconds: 60,
        secure: true,
      }),
    ).toBe("atrium_session=abc; Path=/atrium/api; HttpOnly; SameSite=Lax; Secure; Max-Age=60");
  });

  it("omits Secure only when told the origin is loopback HTTP", () => {
    expect(
      serializeCookie({ name: "a_session", value: "x", path: "/api", secure: false }),
    ).not.toContain("Secure");
  });

  it("refuses a name, value or path that would corrupt the header", () => {
    expect(() => serializeCookie({ name: "a b", value: "x", path: "/", secure: true })).toThrow(
      TypeError,
    );
    expect(() => serializeCookie({ name: "a", value: "x;y", path: "/", secure: true })).toThrow(
      TypeError,
    );
    expect(() =>
      serializeCookie({ name: "a", value: "x", path: "/api; Domain=evil", secure: true }),
    ).toThrow(TypeError);
    expect(() => serializeCookie({ name: "a", value: "x", path: "api", secure: true })).toThrow(
      TypeError,
    );
  });
});

describe("clearedCookie", () => {
  it("matches the attributes it clears, so the browser replaces rather than shadows", () => {
    const cleared = clearedCookie("atrium_session", "/atrium/api", true);
    expect(cleared).toContain("atrium_session=;");
    expect(cleared).toContain("Path=/atrium/api");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});

describe("readCookie", () => {
  it("reads the first occurrence and treats empty as absent", () => {
    expect(readCookie("a=1; atrium_session=tok; atrium_session=shadow", "atrium_session")).toBe(
      "tok",
    );
    expect(readCookie("atrium_session=", "atrium_session")).toBeUndefined();
    expect(readCookie(undefined, "atrium_session")).toBeUndefined();
    expect(readCookie("other_session=tok", "atrium_session")).toBeUndefined();
  });
});

describe("secureCookiesFor", () => {
  it("is Secure everywhere except plain HTTP on loopback", () => {
    expect(secureCookiesFor("https://example.com")).toBe(true);
    expect(secureCookiesFor("http://example.com")).toBe(true);
    expect(secureCookiesFor("http://localhost:5173")).toBe(false);
    expect(secureCookiesFor("http://127.0.0.1:3000")).toBe(false);
    expect(secureCookiesFor("http://[::1]:3000")).toBe(false);
    expect(secureCookiesFor("not a url")).toBe(true);
  });
});
