/**
 * Where keyboard focus goes after a confirmed write (brief 35).
 *
 * ## Why `Confirm` cannot do this on its own
 *
 * A write ends with the dialog closing and the screen reloading its data. The
 * reload sets the screen's loadable back to "loading", which unmounts the whole
 * body, so the button that opened the dialog is gone in the same commit that
 * closes it. Base UI resolves `finalFocus` in that commit, against an opener
 * that is no longer connected, and the reloaded body only mounts once the
 * request is back. So the screen asks for focus before it reloads, and settles
 * it after.
 *
 * ## The rule
 *
 * - The button that opened the dialog, found again after the reload by a
 *   stable key (`data-wc-focus`), if it is there and enabled. A slot that
 *   changes its label keeps its key: Disable becomes Re-enable, Open
 *   registration becomes Close registration.
 * - Otherwise the screen's heading, which carries `tabIndex={-1}`. The thing
 *   is gone (the last grant in an app, an ended session), or its button is
 *   disabled now (Rename once the name matches). The live region's outcome is
 *   read next.
 *
 * A deleted account or app is the one case outside this: the screen becomes
 * its outcome alert, which takes focus itself.
 */

import { useCallback, useRef } from "react";

/**
 * The attribute a screen puts on each button that opens a `Confirm`. JSX needs
 * the name written out, so the screens spell it `data-wc-focus` literally.
 */
export const FOCUS_KEY_ATTRIBUTE = "data-wc-focus";

/** The screen's heading. There is one `h1` per console screen. */
export const HEADING_SELECTOR = ".wc-main h1";

/** The slice of an element this needs. A real `HTMLElement` satisfies it. */
export interface FocusCandidate {
  focus: (options?: FocusOptions) => void;
  /** Present on buttons and inputs; a disabled control cannot take focus. */
  disabled?: boolean;
  /** `aria-disabled="true"` counts too. */
  getAttribute: (name: string) => string | null;
}

/** The slice of a document or element this needs. */
export interface FocusRoot<T extends FocusCandidate = FocusCandidate> {
  querySelector: (selector: string) => T | null;
}

/** `[data-wc-focus="key"]`. Keys are fixed strings chosen in code, never data. */
export function focusKeySelector(key: string): string {
  return `[${FOCUS_KEY_ATTRIBUTE}="${key}"]`;
}

function canTakeFocus(element: FocusCandidate): boolean {
  return element.disabled !== true && element.getAttribute("aria-disabled") !== "true";
}

/**
 * The rule as a pure function: the opener by key if it can take focus, else the
 * heading, else nothing (the screen shows something else, such as an alert that
 * focuses itself).
 */
export function focusTargetAfterWrite<T extends FocusCandidate>(
  root: FocusRoot<T>,
  key: string | undefined,
): T | null {
  if (key !== undefined) {
    const opener = root.querySelector(focusKeySelector(key));
    if (opener !== null && canTakeFocus(opener)) return opener;
  }
  return root.querySelector(HEADING_SELECTOR);
}

/**
 * The screen's half of the rule. Owned by the screen component, above the body
 * the reload remounts, so the request outlives it.
 *
 * - `request(key)` after a write succeeds, before the reload.
 * - `settle()` from an effect once the reloaded data is on screen. It does
 *   nothing unless a request is pending, so it is safe to call on every load.
 */
export function useFocusAfterWrite(): {
  request: (key: string) => void;
  settle: () => void;
} {
  const pending = useRef<string | undefined>(undefined);

  const request = useCallback((key: string) => {
    pending.current = key;
  }, []);

  const settle = useCallback(() => {
    const key = pending.current;
    if (key === undefined) return;
    pending.current = undefined;
    const root: FocusRoot<HTMLElement> = {
      querySelector: (selector) => document.querySelector<HTMLElement>(selector),
    };
    const target = focusTargetAfterWrite(root, key);
    target?.focus();
    // A control can be enabled and still refuse focus, inside a closed
    // disclosure for one. Then the heading, as for a control that is gone.
    if (target !== null && document.activeElement !== target) {
      document.querySelector<HTMLElement>(HEADING_SELECTOR)?.focus();
    }
  }, []);

  return { request, settle };
}
