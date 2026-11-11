/**
 * The console's confirmation dialog, the one place `@base-ui/react/alert-dialog`
 * is imported. It lives under this `ui/` folder so Base UI stays out of the
 * sign-in pages.
 */

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ConfirmProps {
  open: boolean;
  title: string;
  /** What will happen, in the words the result will use. Required. */
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation for an action that changes authority.
 *
 * Base UI's `AlertDialog`, which gives the focus trap (Cancel first), the
 * inertness of the page behind it and Escape-to-cancel from a maintained
 * library instead of from three hundred lines of our own. An alert dialog
 * never closes on a press outside it. Escape arrives as `onOpenChange(false)`,
 * which routes through the same path as the Cancel button and is ignored while
 * busy, so a dialog cannot be dismissed out from under a request in flight.
 *
 * ## Focus
 *
 * Cancel and Escape return focus to the button that opened the dialog, which is
 * Base UI's default. A confirm is different. The confirm button disables itself
 * while busy, so it first moves focus to the popup, or the browser would drop
 * it to `<body>` mid-request. When the write lands the screen reloads, which
 * removes the opener, so `finalFocus` is `false` after a confirm and the screen
 * places focus itself once the reload is on screen (`focus-after-write.ts`).
 */
export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
}: ConfirmProps): React.JSX.Element | null {
  const popupRef = useRef<HTMLDivElement>(null);
  /** Set by the confirm button, cleared each time the dialog opens. */
  const confirmed = useRef(false);
  useEffect(() => {
    if (open) confirmed.current = false;
  }, [open]);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && busy !== true) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="wc-dialog-backdrop" />
        {/* Portalled to <body>, outside the console wrapper, so the popup
            carries the console surface itself or it renders with the light
            sign-in tokens. */}
        <AlertDialog.Popup
          ref={popupRef}
          className="wc-dialog"
          data-ward-surface="console"
          finalFocus={() => !confirmed.current}
        >
          <AlertDialog.Title>{title}</AlertDialog.Title>
          {children}
          <div className="wc-dialog-actions">
            <button type="button" className="wc-btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="wc-btn"
              data-tone={tone}
              onClick={() => {
                confirmed.current = true;
                popupRef.current?.focus();
                onConfirm();
              }}
              disabled={busy}
            >
              {busy === true ? "Working…" : confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
