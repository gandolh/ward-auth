// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitch } from "./components/ThemeSwitch.js";
import { getTheme, readTheme, resolveTheme, setTheme, startTheme } from "./theme.js";

/** A matchMedia whose answer a test can change, and whose listeners it can fire. */
function stubSystem(initialDark: boolean): { setDark: (dark: boolean) => void } {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    setDark(next) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

function isChecked(name: string): boolean {
  return screen.getByRole<HTMLInputElement>("radio", { name }).checked;
}

function applied(): string | undefined {
  return document.documentElement.dataset.theme;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = '<meta name="color-scheme" content="light" />';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the stored choice", () => {
  it("is light on a first visit, even when the system is dark", () => {
    stubSystem(true);
    startTheme();
    expect(applied()).toBe("light");
    expect(getTheme()).toBe("light");
  });

  it.each([
    ["light", false, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const)("%s with a dark system of %s becomes data-theme=%s", (stored, systemDark, expected) => {
    stubSystem(systemDark);
    localStorage.setItem("theme", stored);
    startTheme();
    expect(applied()).toBe(expected);
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(expected);
  });

  it("ignores a value it does not know", () => {
    localStorage.setItem("theme", "sepia");
    expect(readTheme()).toBe("light");
  });

  it("is light when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("light");
    vi.restoreAllMocks();
  });

  it("keeps working when storage refuses a write", () => {
    stubSystem(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setTheme("dark");
    expect(applied()).toBe("dark");
    vi.restoreAllMocks();
  });
});

describe("system", () => {
  it("follows a changed media query, and stops following once another choice is made", () => {
    const system = stubSystem(false);
    setTheme("system");
    expect(applied()).toBe("light");
    system.setDark(true);
    expect(applied()).toBe("dark");
    system.setDark(false);
    expect(applied()).toBe("light");
    setTheme("light");
    system.setDark(true);
    expect(applied()).toBe("light");
  });

  it("resolves to what the system asks for", () => {
    stubSystem(true);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });
});

describe("the control", () => {
  it("has three choices, found by role, and writes only to this device", async () => {
    stubSystem(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    startTheme();
    render(<ThemeSwitch />);

    expect(isChecked("Light")).toBe(true);
    expect(screen.getAllByRole("radio")).toHaveLength(3);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(applied()).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(isChecked("Dark")).toBe(true);

    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(localStorage.getItem("theme")).toBe("system");
    expect(applied()).toBe("light");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
