/**
 * The focus rule after a confirmed write, without a DOM.
 *
 * The rule is pure: given what is on screen after the reload, pick the opener
 * by its key or fall back to the heading. A fake root stands in for the
 * document; the browser half (the reload, Base UI's dialog) was checked by hand
 * and is described in the log's 2026-10-27 entry, and for the writes with no
 * confirmation in its 2026-11-04 entry. There is no DOM environment here, so
 * what lands in `document.activeElement` is checked in the browser.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  focusKeySelector,
  focusTargetAfterWrite,
  HEADING_SELECTOR,
  type FocusCandidate,
  type FocusRoot,
} from "./focus-after-write.js";
import { Panel } from "./ui.js";

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

/**
 * The writes with no confirmation. Each case is the screen as the reload leaves
 * it: the keys present, and whether each keyed element is enabled.
 */
describe("focus after a write with no confirmation", () => {
  const accessHeading = element("Access");

  // Removing: the × that was pressed is gone. Adding: the form comes back
  // empty, so Add role is disabled. Both ask for the panel's heading.
  it("lands on the Access panel's heading after a role is added or removed", () => {
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("access")]: accessHeading, [HEADING_SELECTOR]: heading }),
      "access",
    );
    expect(target?.name).toBe("Access");
  });

  it("lands on the heading after an app's name is saved, its button disabled once the name matches", () => {
    const save = element("Save the name", { disabled: true });
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("app-name")]: save, [HEADING_SELECTOR]: heading }),
      "app-name",
    );
    expect(target?.name).toBe("heading");
  });

  it("returns to Save client settings after the OIDC client is saved", () => {
    const save = element("Save client settings");
    const target = focusTargetAfterWrite(
      root({ [focusKeySelector("oidc-client")]: save, [HEADING_SELECTOR]: heading }),
      "oidc-client",
    );
    expect(target?.name).toBe("Save client settings");
  });
});

describe("a panel heading as a focus target", () => {
  it("carries the key and tabindex -1 when given a focusKey", () => {
    const html = renderToStaticMarkup(
      createElement(Panel, { title: "Access", focusKey: "access" }),
    );
    expect(html).toContain('<h2 tabindex="-1" data-wc-focus="access">Access</h2>');
  });

  it("stays a plain heading without one", () => {
    const html = renderToStaticMarkup(createElement(Panel, { title: "Sessions" }));
    expect(html).toContain("<h2>Sessions</h2>");
  });
});
