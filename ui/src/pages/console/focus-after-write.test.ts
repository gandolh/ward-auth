/**
 * The focus rule after a confirmed write, without a DOM.
 *
 * The rule is pure: given what is on screen after the reload, pick the opener
 * by its key or fall back to the heading. A fake root stands in for the
 * document; the browser half (the reload, Base UI's dialog) was checked by hand
 * and is described in the log's 2026-10-27 entry.
 */

import { describe, expect, it } from "vitest";

import {
  focusKeySelector,
  focusTargetAfterWrite,
  HEADING_SELECTOR,
  type FocusCandidate,
  type FocusRoot,
} from "./focus-after-write.js";

interface FakeElement extends FocusCandidate {
  name: string;
}

function element(
  name: string,
  options: { disabled?: boolean; ariaDisabled?: boolean } = {},
): FakeElement {
  return {
    name,
    disabled: options.disabled,
    focus: () => undefined,
    getAttribute: (attribute) =>
      attribute === "aria-disabled" && options.ariaDisabled === true ? "true" : null,
  };
}

function root(bySelector: Record<string, FakeElement>): FocusRoot<FakeElement> {
  return { querySelector: (selector) => bySelector[selector] ?? null };
}

const heading = element("heading");

describe("focus after a confirmed write", () => {
  it("returns to the opener when the reload kept it", () => {
    const opener = element("Re-enable account");
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("account-state")]: opener, [HEADING_SELECTOR]: heading }),
      "account-state",
    );
    expect(target?.name).toBe("Re-enable account");
  });

  it("falls back to the heading when the opener is gone", () => {
    const target = focusTargetAfterWrite(
      root({ [HEADING_SELECTOR]: heading }),
      "revoke-app:atrium",
    );
    expect(target?.name).toBe("heading");
  });

  it("falls back to the heading when the opener is disabled now", () => {
    const rename = element("Rename", { disabled: true });
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("rename")]: rename, [HEADING_SELECTOR]: heading }),
      "rename",
    );
    expect(target?.name).toBe("heading");
  });

  it("treats aria-disabled as disabled", () => {
    const opener = element("Close registration", { ariaDisabled: true });
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("registration")]: opener, [HEADING_SELECTOR]: heading }),
      "registration",
    );
    expect(target?.name).toBe("heading");
  });

  it("goes to the heading when no key was asked for", () => {
    expect(focusTargetAfterWrite(root({ [HEADING_SELECTOR]: heading }), undefined)?.name).toBe(
      "heading",
    );
  });

  it("answers nothing when the screen has no heading, as a deleted account's alert", () => {
    expect(focusTargetAfterWrite(root({}), "account-state")).toBeNull();
  });

  it("keys a button by its data-wc-focus attribute", () => {
    expect(focusKeySelector("end-session:ab12")).toBe('[data-wc-focus="end-session:ab12"]');
  });
});
