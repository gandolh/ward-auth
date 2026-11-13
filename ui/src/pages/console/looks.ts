/*
 * The console's repeated looks, each a whole class string so Tailwind's scanner
 * reads it. Every colour is a `ward-*` token, and that is a safety property:
 * there is not one hex value in the console's markup. The names resolve to the
 * dark palette under `data-ward-surface="console"` (styles/index.css), which is
 * what gives the console its own identity for free and keeps it consistent when
 * the values change underneath.
 *
 * The identity is the point rather than the decoration. The console is
 * superuser-only, every route on it changes authority, and its one credential
 * cannot be revoked or rotated without a redeploy. Someone reaching for
 * break-glass should be able to see, in the first quarter of a second and without
 * reading a word, that this is not the ordinary login page.
 *
 * ## The one bold element
 *
 * A hazard band: a diagonally striped rule under the top bar, in `ward-notice`
 * on `ward-surface-sunken`. It is the vernacular of the thing itself, a
 * break-glass alarm, an electrical panel, a machine you are not supposed to be
 * inside during normal operation. It costs one gradient and it is the only loud
 * thing in here. Everything else is a quiet, dense ledger.
 *
 * ## Typography carries information
 *
 * The mono face is reserved for opaque identifiers (a subject, a slug, a role, a
 * session id, an audit action, a target id). In this console, monospace means "an
 * exact string Ward stores and never interprets". Prose is never mono and
 * identifiers are never sans, so the operator can tell a value they may retype
 * from a sentence describing it.
 *
 * ## State
 *
 * A look that depends on state is a `data-*` variant on the one string, because
 * the code sets the attribute (`data-tone`, `data-state`, `data-severity`,
 * `data-low`). The narrow layout is `max-console:`, the 60rem breakpoint of
 * styles/index.css.
 */

import { cn } from "../../lib/cn.js";

/* --- Frame --------------------------------------------------------------- */

/** The console's page: a column from the top bar to the end of the body. */
export const frame = "flex min-h-dvh flex-col bg-ward-bg font-ward text-ward-text";

/*
 * The top bar: the wordmark, the standing line, the session clock and Sign out in one row. In the narrow layout
 * (`max-console:`) Sign out stays beside the wordmark and the clock and the standing line take a row each, by `order`,
 * so the markup (and the tab order) is the same at every width.
 */
export const topbar =
  "flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 max-console:gap-x-4 max-console:px-4";

/** The wordmark is a heading on the gate and a way home in the top bar. */
export const wordmark = "text-lg font-bold tracking-[-0.01em]";

/** The wordmark's link is a way home, not a call to action: no accent, no underline. */
export const wordmarkLink = "text-ward-text no-underline hover:text-ward-text hover:underline";

/** The framing, not an eyebrow label: a plain sentence fragment, sentence case. */
export const standing = "min-w-0 flex-1 text-sm text-ward-notice max-console:order-4 max-console:basis-full";

export const countdown =
  "font-ward-mono text-ward-mono whitespace-nowrap text-ward-text-muted tabular-nums data-[low=true]:text-ward-notice max-console:order-3 max-console:basis-full";

export const topbarSignOut = "max-console:order-2 max-console:ml-auto";

/** 6px of diagonal stripe, drawn from tokens. */
export const hazard =
  "h-1.5 flex-none bg-ward-surface-sunken bg-[repeating-linear-gradient(135deg,var(--ward-notice)_0,var(--ward-notice)_6px,transparent_6px,transparent_14px)]";

export const body = "flex min-h-0 flex-1 items-stretch max-console:flex-col";

export const rail =
  "flex w-48 flex-none flex-col gap-1 border-r border-ward-border bg-ward-surface-sunken px-3 py-6 max-console:w-auto max-console:flex-row max-console:flex-wrap max-console:border-r-0 max-console:border-b max-console:px-3 max-console:py-2";

/**
 * A rail entry is navigation, not a link in prose, and a 44 px target. The accent's one appearance in the rail is
 * which surface you are on: a 3 px edge on the current entry.
 */
export const railLink =
  "flex min-h-11 w-full items-center rounded-ward bg-transparent px-3 text-left text-sm text-ward-text-muted no-underline hover:bg-ward-surface hover:text-ward-text aria-[current=page]:bg-ward-surface aria-[current=page]:text-ward-text aria-[current=page]:shadow-[inset_3px_0_0_var(--ward-accent)] max-console:w-auto";

/*
 * `wc-main` is not a style: `focus-after-write.ts` finds the screen's heading with `.wc-main h1`, so the class stays on
 * the page's `<main>` as a hook.
 */
export const main = "wc-main min-w-0 flex-1 px-8 pt-8 pb-10 max-console:px-4 max-console:pt-5 max-console:pb-6";

export const mainInner = "max-w-ward";

/* --- Headings and prose --------------------------------------------------- */

export const head =
  "mb-3 flex flex-wrap items-center gap-4 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:tracking-[-0.01em] max-console:mb-2";

export const headActions = "ml-auto flex gap-2";

/** The line under a screen's heading, capped at 36rem so it reads as a sentence, not a banner. */
export const lede = "mb-6 max-w-[36rem] text-sm text-ward-text-muted max-console:mb-4";

export const back = "mb-3 inline-block text-sm";

/** An opaque value Ward stores verbatim. */
export const id = "font-ward-mono text-sm text-ward-text-muted wrap-anywhere";

/** A screen-reader-only live region for the outcome of a write. */
export const sr = "sr-only";

/* --- Panels: one authority-changing concern each ---------------------------- */

export const panel =
  "mb-6 rounded-lg border border-ward-border bg-ward-surface p-6 " +
  "data-[tone=danger]:border-ward-danger data-[tone=notice]:border-ward-notice " +
  "[&>h2]:mb-2 [&>h2]:text-base [&>h2]:font-semibold";

export const panelNote = "mb-4 max-w-[68ch] text-sm text-ward-text-muted last:mb-0";

/* --- Tables: a ledger, not a card grid -------------------------------------- */

export const tableScroll = "overflow-x-auto";

export const table =
  "w-full border-collapse text-sm " +
  "[&_caption]:pb-2 [&_caption]:text-left [&_caption]:text-sm [&_caption]:text-ward-text-muted " +
  "[&_:is(th,td)]:border-b [&_:is(th,td)]:border-ward-border [&_:is(th,td)]:p-3 [&_:is(th,td)]:text-left [&_:is(th,td)]:align-baseline " +
  "[&_thead_th]:border-ward-border-strong [&_thead_th]:font-medium [&_thead_th]:whitespace-nowrap [&_thead_th]:text-ward-text-faint " +
  "[&_tbody_tr:last-child_:is(th,td)]:border-b-0 [&_tbody_tr:hover]:bg-ward-surface-sunken";

export const when = "font-ward-mono text-xs whitespace-nowrap text-ward-text-muted";

/* --- The account list: a card holding a table from 1000 px, a list of two-line rows below it --- */

export const listCard = "overflow-hidden rounded-ward-card border border-ward-border bg-ward-surface";

/** The count, the card's first row. In the table it is the caption, in the list a paragraph. */
export const listCount =
  "border-b border-ward-border px-6 py-4 text-left text-sm text-ward-text-muted max-ward-list:px-4 max-ward-list:py-3";

export const accountTable =
  "w-full border-collapse text-sm max-ward-list:hidden [&_:is(th,td)]:px-2 [&_:is(th,td):first-child]:pl-6 [&_:is(th,td):last-child]:pr-6 [&_thead_th]:h-10 [&_thead_th]:border-b [&_thead_th]:border-ward-border [&_thead_th]:bg-ward-surface-sunken [&_thead_th]:text-left [&_thead_th]:font-normal [&_thead_th]:text-ward-text-faint [&_tbody_:is(th,td)]:h-16 [&_tbody_:is(th,td)]:border-b [&_tbody_:is(th,td)]:border-ward-border [&_tbody_th]:text-left [&_tbody_tr:last-child_:is(th,td)]:border-b-0";

export const accountName = "font-bold";

/** The subject, whole on one line: it is the string an operator quotes. */
export const accountSubject = "font-ward-mono text-ward-mono whitespace-nowrap text-ward-text-muted";

export const accountWhen = "font-ward-mono text-xs whitespace-nowrap text-ward-text-faint";

export const accountList = "ward-list:hidden";

/*
 * Below 1000 px each account is two lines: the name, created and state, then the subject and the link. At 640 px and
 * under, three: the name and state, the subject, created and the 48 px link.
 */
export const accountRow =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-ward-border px-4 pt-2 pb-3 [grid-template-areas:'name_when_state'_'id_id_act'] last:border-b-0 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:pt-1 max-sm:[grid-template-areas:'name_state'_'id_id'_'when_act']";

export const rowName = "flex min-h-11 items-center font-bold [grid-area:name]";

export const rowState = "text-right [grid-area:state]";

export const rowSubject =
  "pb-2 font-ward-mono text-xs tracking-[-0.02em] text-ward-text-muted wrap-anywhere [grid-area:id]";

export const rowWhen = "font-ward-mono text-xs whitespace-nowrap text-ward-text-faint [grid-area:when]";

export const rowAction = "justify-self-end [grid-area:act]";

/* --- State words ------------------------------------------------------------ */

export const state =
  "text-sm data-[state=disabled]:text-ward-danger data-[state=none]:text-ward-text-faint data-[state=open]:text-ward-notice";

/* --- Roles as a set: one chip each, one click to remove ---------------------- */

export const roles = "flex flex-wrap gap-2";

export const role =
  "inline-flex items-center gap-2 rounded-full border border-ward-border-strong bg-ward-surface-sunken py-1 pr-1 pl-3 font-ward-mono text-sm";

export const roleDrop =
  "cursor-pointer rounded-full bg-transparent px-2 py-1 leading-none text-ward-text-muted hover:bg-ward-danger-surface hover:text-ward-danger";

export const appGrant =
  "border-b border-ward-border py-4 last-of-type:border-b-0 [&>h3]:mb-1 [&>h3]:font-ward-mono [&>h3]:text-sm [&>h3]:font-semibold";

export const appGrantMeta = "mb-3 text-xs text-ward-text-faint";

/* --- Empty states: a designed sentence, never a grey dash --------------------- */

export const empty =
  "rounded-ward border border-dashed border-ward-border-strong bg-ward-surface-sunken p-6 " +
  "[&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold " +
  "[&_p]:max-w-[66ch] [&_p]:text-sm [&_p]:text-ward-text-muted [&_p+p]:mt-2";

/* --- Forms -------------------------------------------------------------------- */

/*
 * A form is a grid, not a flex column: a field carries `flex-[1_1_12rem]` for the
 * horizontal form below, and in a flex column that basis would be read as a
 * height, a field 12rem tall with 3rem of content in it. A grid ignores it.
 */
export const form = "grid max-w-[30rem] gap-4";

/** A horizontal form: the add-a-role row, the audit filters. */
export const formRow = "flex flex-wrap items-end gap-3";

/** The add-a-role row sits under the grant list it extends. */
export const grantAdd = "mt-6 flex flex-wrap items-end gap-3";

/*
 * A field is a `<p>` so the label, the input, the hint and the error are one
 * paragraph-level unit.
 */
export const field = "flex min-w-0 flex-[1_1_12rem] flex-col gap-1";

export const fieldLabel = "text-sm font-medium";

export const fieldHint = "max-w-[60ch] text-xs text-ward-text-faint";

export const fieldError = "text-xs text-ward-danger";

/** An input or a select. */
export const control =
  "w-full min-w-0 rounded-ward border border-ward-border-strong bg-ward-surface-sunken px-3 py-2 text-sm text-ward-text placeholder:text-ward-text-faint";

/** An opaque identifier is typed as well as read, so the field is mono too. */
export const controlMono = `${control} font-ward-mono`;

export const check = "my-3.5 flex items-start gap-3 text-sm [&_input]:mt-[0.2em] [&_input]:accent-ward-accent";

/**
 * The button that ends a horizontal form. Not a `field`: a field is a
 * label-and-input column, and putting a button in one stretches it to the
 * column's width and pushes it out of line with the inputs beside it. Fields in
 * a row form carry no hint for the same alignment reason.
 */
export const rowActions = "flex flex-none gap-2";

/* --- Buttons: one accent per region; danger only where something is destroyed - */

/* A 44 px target (48 in the narrow layout); a disabled button never reacts to hover. */
export const btn =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ward border border-ward-border-strong bg-transparent px-4 text-sm font-semibold whitespace-nowrap text-ward-text no-underline hover:not-disabled:bg-ward-surface-sunken disabled:cursor-default disabled:opacity-50 max-console:min-h-12 data-[tone=danger]:border-ward-danger data-[tone=danger]:text-ward-danger data-[tone=danger]:hover:not-disabled:bg-ward-danger-surface data-[tone=primary]:border-ward-accent data-[tone=primary]:bg-ward-accent data-[tone=primary]:text-ward-accent-text data-[tone=primary]:hover:not-disabled:border-ward-accent-hover data-[tone=primary]:hover:not-disabled:bg-ward-accent-hover";

/**
 * A button that is a link to another screen. The console's link colour is the accent, and a link beats a button's own
 * text colour, as it did before the move to Tailwind, so the label reads as navigation.
 */
export const btnAsLink = cn(btn, "text-ward-accent hover:text-ward-accent-hover");

export const btnLink = "cursor-pointer bg-transparent p-0 text-sm text-ward-accent underline underline-offset-2";

export const actions = "flex flex-wrap items-center gap-3";

/* --- Messages: `danger` is destruction, not a wrong password ------------------- */

export const alert =
  "mb-4 rounded-ward border border-ward-border-strong px-4 py-3 text-sm " +
  "data-[tone=error]:border-ward-danger data-[tone=error]:bg-ward-danger-surface data-[tone=error]:text-ward-text " +
  "data-[tone=notice]:border-ward-notice data-[tone=notice]:bg-ward-notice-surface " +
  "data-[tone=done]:bg-ward-surface-sunken data-[tone=done]:text-ward-text-muted " +
  "[&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-bold";

/* --- Audit: the alarm is the only red thing in the log -------------------------- */

export const auditRow =
  "group/audit data-[severity=alarm]:bg-ward-danger-surface data-[severity=alarm]:hover:bg-ward-danger-surface";

export const auditLabel =
  "text-sm group-data-[severity=alarm]/audit:font-semibold group-data-[severity=alarm]/audit:text-ward-danger " +
  "group-data-[severity=authority]/audit:text-ward-text group-data-[severity=benign]/audit:text-ward-text-muted " +
  "group-data-[severity=notice]/audit:text-ward-notice";

export const action = "block font-ward-mono text-xs text-ward-text-faint";

export const auditWhy = "mt-1 max-w-[74ch] text-xs text-ward-text-muted";

export const detail = "mt-1 font-ward-mono text-xs whitespace-pre-wrap text-ward-text-muted wrap-anywhere";

/* --- The login screen: deliberately not the shape of the ordinary login page ----- */

export const gateInner =
  "mx-auto grid flex-1 grid-cols-[minmax(0,26rem)_minmax(0,30rem)] content-start gap-8 px-6 py-12 max-console:grid-cols-[minmax(0,34rem)]";

export const gateHeading = "mb-3 text-xl font-semibold tracking-[-0.015em]";

export const gateTerms =
  "text-sm text-ward-text-muted [&>dd]:mt-1 [&>dd]:max-w-[46ch] [&>dt]:mt-4 [&>dt]:font-semibold [&>dt]:text-ward-text";

/* --- Confirmation: Base UI's AlertDialog, portalled to <body> ---------------------- */

export const dialogBackdrop = "fixed inset-0 z-overlay bg-black/60";

/*
 * A fixed box in the middle of the window, which a native <dialog> got from the
 * browser. The popup carries the console surface itself (Confirm.tsx), so these
 * tokens resolve to the dark palette outside the console's wrapper. The
 * description is the caller's own `<p>`s.
 */
export const dialog =
  "fixed top-1/2 left-1/2 z-dialog max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] max-w-[34rem] -translate-x-1/2 -translate-y-1/2 overflow-y-auto " +
  "rounded-lg border border-ward-border-strong bg-ward-surface p-6 font-ward text-ward-text shadow-ward-lg " +
  "[&_p]:mb-3 [&_p]:max-w-[62ch] [&_p]:text-sm [&_p]:text-ward-text-muted";

export const dialogTitle = "mb-3 text-lg font-bold";

export const dialogActions = "mt-6 flex justify-end gap-3";
