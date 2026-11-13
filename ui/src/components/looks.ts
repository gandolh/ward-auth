/*
 * The sign-in pages' repeated looks, each a whole class string so Tailwind's
 * scanner reads it. Nothing here imports Base UI or `cn()`: the pages that use
 * these download none of Base UI, and `cn()` would put tailwind-merge (9 kB
 * gzipped) into the chunk every sign-in page downloads. So a variant is a whole
 * string, not a merge of a base and an override.
 *
 * Body copy is 14/20 on a wide screen and 16/24 on a phone (`max-sm:`), where
 * it is read at arm's length.
 */

/** A paragraph of explanation. */
export const prose = "mb-4 max-w-[44ch] text-sm text-ward-text-muted last:mb-0 max-sm:text-base";

/** A paragraph that follows a block and wants room above it. */
export const proseSpaced = "mt-6 mb-4 max-w-[44ch] text-sm text-ward-text-muted last:mb-0 max-sm:text-base";

/** A link in prose: the accent, underlined, a heavier line on hover. */
export const link = "rounded-xs text-ward-accent underline decoration-1 underline-offset-2 hover:decoration-2";

/** The same link in the footer's small print, a 44 px target. */
export const footLink =
  "inline-flex min-h-11 items-center rounded-xs text-ward-accent underline decoration-1 underline-offset-2 hover:decoration-2";

/**
 * A card: one group of the page. One elevation for every card: a border plus the soft shadow in light, a border
 * plus a lighter surface in dark (where `--ward-shadow` is `none`).
 */
export const card = "rounded-ward-card border border-ward-border bg-ward-surface p-6 shadow-ward max-sm:p-4";

/** The sign-in card: the form, hung off the jamb at the sign-in width, the whole content width on a phone. */
export const doorCard =
  "max-w-ward rounded-ward-card border border-ward-border bg-ward-surface p-6 shadow-ward max-sm:max-w-none max-sm:px-4 max-sm:py-5";

/** A card's plain text: 14/20, 16/24 on a phone. */
export const note = "text-sm text-ward-text-muted max-sm:text-base";

/** A card's title. */
export const cardTitle = "mb-2 text-lg font-semibold text-ward-text";

/** A stack of fields. */
export const form = "grid gap-4";

/** The buttons that end a form. */
export const actions = "flex flex-wrap items-center gap-3";

/** A small note under a field, or under a button: one helper size, 12/16. */
export const hint = "text-xs text-ward-text-faint";

/** The note when it says what went wrong. */
export const hintError = "text-sm text-ward-danger";

/*
 * A disabled button never reacts to hover: every hover look is behind `enabled:`, so a locked-out "Sign in" stays
 * the flat disabled look under the pointer.
 */
const BUTTONS = {
  primary:
    "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ward border border-ward-accent bg-ward-accent px-5 py-3 text-center text-sm font-semibold whitespace-nowrap text-ward-accent-text transition-[background-color,border-color,color] duration-120 ease-ward hover:enabled:border-ward-accent-hover hover:enabled:bg-ward-accent-hover disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint max-sm:min-h-12",
  /* The primary, full width in its card: the sign-in and registration forms. */
  block:
    "mt-1 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-ward border border-ward-accent bg-ward-accent px-5 py-3 text-center text-sm font-semibold whitespace-nowrap text-ward-accent-text transition-[background-color,border-color,color] duration-120 ease-ward hover:enabled:border-ward-accent-hover hover:enabled:bg-ward-accent-hover disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint max-sm:min-h-12",
  /* The accent is spent once per screen, so every secondary action is an outline. */
  quiet:
    "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ward border border-ward-border-strong bg-transparent px-5 py-3 text-center text-sm font-semibold whitespace-nowrap text-ward-text transition-[background-color,border-color,color] duration-120 ease-ward hover:enabled:bg-ward-surface-sunken disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint max-sm:min-h-12",
  /* Sign out in the pass: the outline, full width under its caption; beside it, at its own width, on a phone. */
  pass: "mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-ward border border-ward-border-strong bg-transparent px-5 py-3 text-center text-sm font-semibold whitespace-nowrap text-ward-text transition-[background-color,border-color,color] duration-120 ease-ward hover:enabled:bg-ward-surface-sunken disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint max-sm:mt-0 max-sm:min-h-12 max-sm:w-auto max-sm:flex-none",
  danger:
    "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ward border border-ward-danger bg-transparent px-5 py-3 text-center text-sm font-semibold whitespace-nowrap text-ward-danger transition-[background-color,border-color,color] duration-120 ease-ward hover:enabled:bg-ward-danger hover:enabled:text-ward-accent-text disabled:cursor-not-allowed disabled:border-ward-border disabled:bg-ward-surface-sunken disabled:text-ward-text-faint max-sm:min-h-12",
} as const;

/** A button: the accent one (full width with `block`), the outline one, or the outline in red for something destroyed. */
export function button(variant: keyof typeof BUTTONS = "primary"): string {
  return BUTTONS[variant];
}
