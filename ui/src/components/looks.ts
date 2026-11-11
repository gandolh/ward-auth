/*
 * The sign-in pages' repeated looks, each a whole class string so Tailwind's
 * scanner reads it. Nothing here imports Base UI or `cn()`: the pages that use
 * these download none of Base UI, and `cn()` would put tailwind-merge (9 kB
 * gzipped) into the chunk every sign-in page downloads. So a variant is a whole
 * string, not a merge of a base and an override.
 */

/** The line under a heading that says what the page is for. */
export const lede = "mb-8 max-w-[38ch] text-sm text-ward-text-muted";

/** A paragraph of explanation. */
export const prose = "mb-4 max-w-[44ch] text-sm text-ward-text-muted last:mb-0";

/** A paragraph that follows a block and wants room above it. */
export const proseSpaced = "mt-6 mb-4 max-w-[44ch] text-sm text-ward-text-muted last:mb-0";

/** A link in prose: the accent, underlined, a heavier line on hover. */
export const link = "rounded-xs text-ward-accent underline decoration-1 underline-offset-[0.18em] hover:decoration-2";

/** A stack of fields. */
export const form = "grid gap-5";

/** The buttons that end a form. */
export const actions = "flex flex-wrap items-center gap-3";

/** A small note under a field, or beside a button. */
export const hint = "text-xs text-ward-text-faint";

/** The same note when it says what went wrong. */
export const hintError = "text-xs text-ward-danger";

const BUTTON =
  "cursor-pointer rounded-ward border px-5 py-3 font-semibold transition-[background-color,color] duration-120 ease-ward " +
  "disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint";

const BUTTONS = {
  primary: `${BUTTON} border-transparent bg-ward-accent text-ward-accent-text hover:enabled:bg-ward-accent-hover`,
  /* The accent is spent once per screen, so every secondary action is an outline. */
  quiet: `${BUTTON} border-ward-border-strong bg-transparent text-ward-text hover:enabled:bg-ward-surface-sunken`,
  danger: `${BUTTON} border-ward-danger bg-transparent text-ward-danger hover:enabled:bg-ward-danger hover:enabled:text-ward-accent-text`,
} as const;

/** A button: the accent one, the outline one, or the outline in red for something destroyed. */
export function button(variant: keyof typeof BUTTONS = "primary"): string {
  return BUTTONS[variant];
}
