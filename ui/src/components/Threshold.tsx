import type { ReactNode } from "react";

/*
 * The jamb: one vertical rule set in from the left edge, with the whole crossing hung off it. A hairline for the
 * full height and a short 2px head at the very top, drawn as two pseudo-elements so the rule changes weight without
 * a second element in the markup. The head is a fixed short cap, not the height of the heading: app names run from
 * "Ward" to "Public Resource Map", and a weight change that lands halfway down a two-line heading reads as a bug.
 *
 * The destination line is the one piece of type on this surface allowed to be large, set tight and heavy enough to
 * read as a signpost, and `text-balance` keeps a two-word orphan off its second line. The headings are the
 * crossing's own children, so they are styled from here.
 */
const CROSSING = [
  "relative w-full pl-6",
  "before:absolute before:top-0 before:left-0 before:h-full before:w-px before:bg-ward-border",
  "after:absolute after:top-0 after:left-0 after:h-8 after:w-0.5 after:bg-ward-border-strong",
  "[&>h1]:mb-3 [&>h1]:max-w-[20ch] [&>h1]:text-ward-signpost [&>h1]:leading-[1.12] [&>h1]:font-semibold [&>h1]:tracking-[-0.022em] [&>h1]:text-balance",
  "[&>h2]:mt-10 [&>h2]:mb-3 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-[-0.012em]",
].join(" ");

const NARROW = `${CROSSING} max-w-ward`;
const WIDE = `${CROSSING} max-w-ward-wide`;

/**
 * The page shell for every screen on the sign-in side.
 *
 * Three rows: the wordmark, the crossing, one line of small print. The
 * crossing hangs off a rule on the left instead of sitting in a centred card:
 * a centred card floating in the middle of a viewport is what every login page
 * looks like, and it reads as a destination, a lobby you have arrived in. This
 * page is a door somebody is passing through on their way to another app, and
 * the destination, not Ward, is the headline.
 *
 * The wordmark is the only place Ward names itself, and it is deliberately the
 * smallest type on the page. Somebody arriving here was on their way to Atrium
 * or Newspapper; the interruption is shorter if the page leads with where they
 * were going.
 *
 * It is a `<p>` and **not** a heading. A heading above the `h1` would make the
 * page's outline start with the service's name and demote what the page is
 * actually for, which is the same inversion the visual design avoids. The one
 * `h1` per page is the destination or the task.
 */
export function Threshold({
  children,
  wide = false,
  footer,
}: {
  children: ReactNode;
  /** The self-service page is read rather than crossed, so it gets more room. */
  wide?: boolean;
  /** One line of small print. Omitted rather than filled with something. */
  footer?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] gap-8 p-6 max-sm:gap-6 max-sm:p-5">
      <p className="text-sm font-semibold tracking-[0.02em] text-ward-text-muted">Ward</p>
      <div className="flex items-center pl-[clamp(0rem,7vw,9rem)] max-sm:items-start max-sm:pl-0">
        <main className={wide ? WIDE : NARROW}>{children}</main>
      </div>
      {footer === undefined ? <div /> : <p className="text-xs text-ward-text-faint">{footer}</p>}
    </div>
  );
}
