import type { ReactNode } from "react";

/*
 * The jamb: one vertical rule set in from the left edge, with the crossing hung off it. A hairline in the strong
 * border colour and a 3 px accent cap at the very top, drawn as two pseudo-elements so the rule changes weight without
 * a second element in the markup. The cap is a fixed 44 px, not the height of the heading: app names run from "Ward"
 * to "Public Resource Map", and a weight change that lands halfway down a two-line heading reads as a bug.
 *
 * On a sign-in page the rule runs beside the heading and the card under it. Below 640 px (`max-sm:`) it stops
 * under the lede, as the account page's does at every width, and the card takes the whole content width: a rail
 * beside the card would narrow every field on the phone. The door is the card's width plus the jamb's 24 px, so a
 * notice or a line of prose under the heading keeps the card's measure.
 */
const DOOR =
  "relative ml-[clamp(0rem,7vw,9rem)] max-w-[calc(var(--container-ward)+1.5rem)] pl-6 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ward-border-strong after:absolute after:top-0 after:-left-px after:h-11 after:w-0.75 after:bg-ward-accent max-sm:ml-0 max-sm:max-w-none max-sm:pl-0 max-sm:before:hidden max-sm:after:hidden";

const DOOR_HEAD =
  "relative mb-6 max-sm:mb-4 max-sm:pl-4 max-sm:before:absolute max-sm:before:inset-y-0 max-sm:before:left-0 max-sm:before:w-px max-sm:before:bg-ward-border-strong max-sm:after:absolute max-sm:after:top-0 max-sm:after:-left-px max-sm:after:h-11 max-sm:after:w-0.75 max-sm:after:bg-ward-accent";

const PAGE = "ml-[clamp(0rem,7vw,9rem)] max-w-ward-account max-sm:ml-0";

const PAGE_HEAD =
  "relative mb-6 max-w-[40rem] pl-6 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ward-border-strong after:absolute after:top-0 after:-left-px after:h-11 after:w-0.75 after:bg-ward-accent max-sm:mb-4 max-sm:pl-4";

/*
 * The destination line is the one piece of type on this surface allowed to be large, set heavy enough to read as a
 * signpost, and `text-balance` keeps a two-word orphan off its second line.
 */
const HEADING = "text-ward-signpost font-bold tracking-[-0.01em] text-balance";

const LEDE = "mt-3 max-w-[30rem] text-sm text-ward-text-muted max-sm:mt-2 max-sm:text-base";

/**
 * The page shell for every screen on the sign-in side.
 *
 * Three rows: a band with the wordmark, the crossing, one line of small print. The crossing hangs off a rule on the
 * left instead of sitting in a centred card: a centred card floating in the middle of a viewport is what every login
 * page looks like, and it reads as a destination, a lobby you have arrived in. This page is a door somebody is
 * passing through on their way to another app, and the destination, not Ward, is the headline. Since 2026-11-13 the
 * form itself sits on a card (docs/design.md), but that card hangs off the jamb, left-aligned, and is never centred.
 *
 * The wordmark is the only place Ward names itself, and it is deliberately the smallest type on the page, alone in its
 * band. Somebody arriving here was on their way to Atrium or Newspapper; the interruption is shorter if the page leads
 * with where they were going.
 *
 * It is a `<p>` and **not** a heading. A heading above the `h1` would make the page's outline start with the service's
 * name and demote what the page is actually for, which is the same inversion the visual design avoids. The one `h1`
 * per page is the destination or the task, and the shell draws it from `heading`.
 */
export function Threshold({
  heading,
  lede,
  children,
  wide = false,
  footer,
}: {
  /** The page's one `h1`: the destination or the task. */
  heading: ReactNode;
  /** The line under it that says what the page is for. */
  lede: ReactNode;
  children?: ReactNode;
  /**
   * The self-service page is read rather than crossed: its heading keeps the rule to itself, and the page under it is
   * a grid of cards at the top of the screen rather than a door in the middle of it.
   */
  wide?: boolean;
  /** One line of small print. Omitted rather than filled with something. */
  footer?: ReactNode;
}): React.JSX.Element {
  const head = (
    <>
      <h1 className={HEADING}>{heading}</h1>
      <p className={LEDE}>{lede}</p>
    </>
  );

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto]">
      <div className="flex h-ward-band items-center border-b border-ward-border bg-ward-surface px-6 max-sm:h-12 max-sm:px-5">
        <p className="text-sm font-semibold text-ward-text-muted">Ward</p>
      </div>
      {wide ? (
        <main className="flex flex-col px-6 pt-8 pb-10 max-sm:px-5 max-sm:pt-4 max-sm:pb-6">
          <div className={PAGE}>
            <div className={PAGE_HEAD}>{head}</div>
            {children}
          </div>
        </main>
      ) : (
        <main className="flex flex-col justify-center px-6 pt-8 pb-10 max-sm:justify-start max-sm:px-5 max-sm:pt-4 max-sm:pb-6">
          <div className={DOOR}>
            <div className={DOOR_HEAD}>{head}</div>
            {children}
          </div>
        </main>
      )}
      {footer === undefined ? (
        <div />
      ) : (
        <div className="px-6 pt-4 pb-6 max-sm:px-5 max-sm:pt-3">
          <p className="ml-[clamp(0rem,7vw,9rem)] flex flex-wrap items-center gap-x-1 text-xs text-ward-text-faint max-sm:ml-0">
            {footer}
          </p>
        </div>
      )}
    </div>
  );
}
