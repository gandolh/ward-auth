import { describe, expect, it } from "vitest";

import { interactionAbortUrl, interactionResumeUrl, oidcInteraction, parseClient } from "./oidc.js";

/**
 * `?oidc=` carries an interaction id and nothing else, and the page builds the
 * destination from a constant. These pin that a value which could steer the
 * browser anywhere but Ward's own interaction route is not an id.
 */
describe("oidcInteraction", () => {
  it("accepts a nanoid-shaped id", () => {
    expect(oidcInteraction("nVAL-ym1voHX184OIc1qmiwaE47gY3P7tPqJbwbtTVK")).toBe(
      "nVAL-ym1voHX184OIc1qmiwaE47gY3P7tPqJbwbtTVK",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "../../evil",
    "abc/def",
    "https://evil.example",
    "//evil.example",
    "abc?x=1",
    "abc%2Fdef",
    "a".repeat(65),
    "abc def",
  ])("refuses %j", (raw) => {
    expect(oidcInteraction(raw)).toBeUndefined();
  });

  it("builds the resume and abort URLs under Ward's API", () => {
    expect(interactionResumeUrl("abc")).toBe("/ward-api/refresh/oidc/abc");
    expect(interactionAbortUrl("abc")).toBe("/ward-api/refresh/oidc/abc/abort");
  });
});

describe("parseClient", () => {
  it("reads the client endpoint's body and nothing else", () => {
    expect(parseClient({ clientId: "atrium", name: "Atrium" })).toEqual({
      clientId: "atrium",
      name: "Atrium",
    });
    expect(parseClient({ clientId: "atrium" })).toBeUndefined();
    expect(parseClient({ clientId: "atrium", name: "" })).toBeUndefined();
    expect(parseClient(null)).toBeUndefined();
    expect(parseClient("Atrium")).toBeUndefined();
  });
});
