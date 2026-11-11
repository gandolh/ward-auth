import { useSyncExternalStore } from "react";

/** The theme the person picked. `system` follows the operating system, live. */
export type Theme = "light" | "dark" | "system";

/** What is on screen: `data-theme` on `<html>` is always one of these two. */
export type AppliedTheme = "light" | "dark";

export const THEME_KEY = "theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** The stored choice. Light on a first visit, and whenever storage is blocked. */
export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : "light";
  } catch {
    return "light";
  }
}

/** What a choice looks like right now: `system` is whatever the operating system asks for. */
export function resolveTheme(theme: Theme): AppliedTheme {
  if (theme === "system") return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  return theme;
}

/*
 * The theme is device state, not account state: Ward keeps no per-user display settings, so the choice lives in
 * localStorage and nothing is sent anywhere. The inline script in index.html sets `data-theme` before the first paint;
 * this module owns it from then on.
 */
let current: Theme = typeof window === "undefined" ? "light" : readTheme();
const listeners = new Set<() => void>();
let media: MediaQueryList | undefined;

function paint(): void {
  const applied = resolveTheme(current);
  document.documentElement.dataset.theme = applied;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", applied);
}

function followSystem(): void {
  paint();
}

/** Applies the stored choice and, for `system`, follows the operating system. Called once, from main.tsx. */
export function startTheme(): void {
  current = readTheme();
  watch();
  paint();
}

function watch(): void {
  media?.removeEventListener("change", followSystem);
  media = undefined;
  if (current !== "system") return;
  media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", followSystem);
}

/** The choice in force. */
export function getTheme(): Theme {
  return current;
}

/** Applies a choice to `<html>`, keeps it on this device and tells every subscriber. */
export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage is blocked (a private window): the choice lasts until the tab closes.
  }
  watch();
  paint();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The choice in force, re-rendering when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "light");
}
