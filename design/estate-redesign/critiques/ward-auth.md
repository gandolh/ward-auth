fix

# ward-auth: design critique of "The pass and its doors" (2026-11-13)

Read from the images first: today's shots (1280x800, 390x844), the builder's twin renders at 1280/1024/768/390/360 in both themes, and the Direction render. I measured positions with headless Chromium on the twins and with PIL on today's PNGs. Today was never captured at 360, 768 or 1024, so findings at those widths sit under priority issues, not regressions.

## First-screen density, today against the build (y in px)

Today's y values are ink tops read from the PNGs. The build's are element box tops. That is why today's reach heading reads 432 here and 440 in the builder's report, which is the same heading.

| Screen, viewport | Today | Build |
|---|---|---|
| Account 1280x800 | Who you are, reach heading 377, both rows, Password heading 610 and the Current password field. No Sign out, no Change password. | Whole pass with Sign out 566-612, reach heading 229, both rows, all three password fields, Change password 692-738 and its hint. |
| Account 390x844 | Reach heading 432, rows 542 and 588, Password heading 665, Current password field 729-778. Sign out is the last section, far off. | Whole pass with Sign out 479-527, reach heading 597, both rows (end 790), Password card edge at 823. Its heading (840) is off. |
| Account 360x800 | not captured | Same y as 390. Rows end 790, the reach card's foot (807) is cut, Password off. |
| Sign-in 1280x800 | Form, Sign in 538-588, footer | Form card, Sign in 497-543, footer |
| Sign-in 390x844 | Fields 326 wide, Sign in 376-425 | Fields 300 wide, Sign in 394-442 |
| Sign-in 360x800 | not captured | Fields 270 wide, Sign in 394-442 |
| Console 1280x800 | 5 whole rows (332-652) | 5 whole rows (296-616) |
| Console 390x844 | 2 whole rows (511-831), Created clipped, the action off to the side | 3 whole rows with the action (417-828) |
| Console 360x800 | not captured | 2 whole rows, the third cut through its button |
| Console 1024x768 | not captured | 3 whole rows and part of a fourth, 137 px each |

**The Sign out trade holds.** Sign out goes from off both first screens to y 479 on the phone and 566 on desktop. Both app rows stay whole on the phone's first screen at 390x844 and 360x800, so ruling 3's test passes. The phone loses the Password heading and one empty field, and today's phone never showed Change password on the first screen either. Changing a password is rare. Signing out on a borrowed or shared device is the action you want in reach.

**Room comes back through spacing, nothing else.** I injected six rules at max-width 600 and measured them. `.stage` top padding 24 to 16, `.head` margin-bottom 20 to 16, `.grid` gap 24 to 16 (the 16 the cards already use), `.pass .rule` margin 16/12 to 12/12, `.rows` margin-top 16 to 12, `.kv .who` margin-bottom 8 to 4. Result at 390x844: reach heading 569, the reach card closes at 775, and the Password card shows its heading at 808-832, which tells the reader the page goes on. At 360x800 the reach card closes on screen. The cards keep 16 px between them, so the islands stay. Going further would mean moving Sign out back (ruled), cutting copy (the brief forbids it) or dropping phone body below 16 px (the direction's type scale).

## Regressions against today

1. **Sign-in, 390.** Today's fields are 326 px wide. The build's are 300 (270 at 360) because the jamb now runs the full height beside the card (y 72 to 463) and indents it to x 36, while the account cards sit at x 20 and are 350 wide. Fix: at 600 and under, stop the jamb under the lede as the account head does, and hang the card at the 20 px gutter, 350 wide, fields 316. Keep the hung card at 1280. **Clash for the controller:** ruling 5 says both "hang the sign-in card off the same jamb" and "no full-height rail on the phone (it narrows every card)". On the phone the two can't both hold. I'd follow the second clause.
2. **Account pass, 1280: labels read as values.** `Username`, `Account id` and `Email` are 14/20 400, the same as their values, and differ only in colour (#4a4f49 against #191b19). Today's label column kept them apart. The stacked layout won the judging, so keep it and fix the step. Labels at 12/16 in `text-faint` (#5d6259, 6.26 on surface), 4 px above the value, 16 px between pairs. That is the one helper size from ruling 4. The phone already has 14 against 16 and can stay.
3. **Console, 1280 and 390: the lede sits on the card.** The lede's bottom and the card's top are both y 202 (371 on the phone). Today had about 30 px there. `:is(.cs,.cs-scope) :is(p,h1){margin:0}` (specificity 0,1,1) beats `.cs-lede{margin-bottom:24px}` (0,1,0). Wrap the reset in `:where()` so the 24 px (16 on the phone) comes back. The lede also runs 704 px, about 110 characters a line. Cap it at 36rem (576 px).
4. **Console 1280: the column heads miss their columns.** `State` sits at x 725 over values at 730, `Created` at 872 over 878. The heads are a separate grid of `aria-hidden` spans over a `ul`, so a screen reader also gets no column names. Draw it as one `<table>` with `<th scope="col">` at desktop widths and keep the list rows for narrow screens.

Nothing else regressed. Desktop account is a clear gain, and console at 390 went from two rows clipped sideways with no visible action to three whole rows with a 48 px action.

## Priority issues (ranked by cost to the user)

1. **A disabled primary lights up on hover.** I hovered the lockout `Sign in` and `Signing in…` specimens. The background turns `accent-hover` (#223829) under `text-faint` (#5d6259), 2.0:1. In dark it's #979c93 on #b9d4c0, 1.8:1. `.btn.primary:hover` (0,3,0) outranks `.btn[disabled]` (0,2,0). Someone who is locked out sees the dead button turn live and become unreadable. Fix: `.btn.primary:not([disabled]):hover`, and the same guard on `.btn:hover`.
2. **Sign-in card on the phone** (regression 1). This is the most-used screen and it's on Android. Fields 300 against today's 326.
3. **Account phone spacing** (the six rules above). The Password heading returns as a cue at 390x844. No content moves.
4. **Console list rows from 1100 down.** At 1024x768, 137 px rows show 3 whole accounts. I forced the table at 1024, 1000, 992 and 980: subject in 12 px mono, whole (230 px), State 64, Created and the action at their own width, 16 px gaps, 16 px side padding. All 5 rows end by y 608. The action stays inside the card's padding down to 992 and eats 11 px of it at 980, so move the fold from 1100 to 1000. From 601 to 1000 use a two-line row: name, created and state on one line, then the subject and `Access and state`. Measured at 768 and 900, those rows are 105 px against 137, and all 5 end at y 792 on 768x1024 (952 as built). Keep ruling 7's list rows at 600 and under.
5. **Pass labels against values** (regression 2).
6. **Console polish.** The lede gap and its measure (regression 3) and the column heads (regression 4). Also, at 768x1024 a white band shows under the rail (y 993 to 1024), because the shell's min-height is 800 and `html` stays transparent. Give the console root `min-height:100dvh` and paint `html` with the console `bg` when the console is mounted.
7. **The Direction render draws the console in public light.** `build.mjs` passes the screen twins through `twinCs` but not the direction body. Its four `data-ward-surface="console"` blocks get no `data-theme="console"`, so `direction-*-1440.png` shows green buttons and light swatches labelled #181a1c. The two renders are byte-identical. The canvas file is right. Wrap the direction body and re-shoot. This is a render fault, separate from the ruled "console dark in both themes".

## Strengths to keep

- **Desktop account's first screen does the jobs.** Sign out, both reach rows and the whole Change password form (button at 692-738) are all in view. Today showed none of those actions.
- **Islands with real depth.** Every group is its own card: surface on ground 1.23 light and 1.19 dark, edge 1.37 and 1.64, one shared shadow, pass included. The 56 px band sits on surface over the ground. Dark is designed, not inverted: lighter cards on a green-black ground, sunken fields, a pale lichen primary with dark text.
- **The console is still its own building** (graphite, brass, the hazard band) and is now a proper phone list. The subject is whole on one mono line, the action is 48 px, and nothing scrolls sideways.
- **Restraint.** One solid accent per screen, `danger` only on Sign out my other devices, roles as plain muted text, and every state written, the lockout countdown included.

## Heuristics (0-4) and the detector

1. Visibility of system status 3. Every state is drawn and the console shows the session timer. The disabled hover misleads.
2. Match with the real world 3. Plain copy ("Read-only.", "whoever runs the estate"). `Subject` is today's jargon, kept.
3. User control and freedom 3. Sign out on the first screen at both widths, plus sign out other devices. The confirm dialog wasn't redrawn.
4. Consistency and standards 3. One elevation, one accent. The sign-in phone card differs from the account cards and the console heads are offset.
5. Error prevention 3. New password twice, the 8-character hint ahead of submit, danger kept for the destructive action.
6. Recognition over recall 3. Everything is labelled. Pass labels are weak at 1280.
7. Flexibility and efficiency 2. List rows down from 1100 halve what a 1024 screen shows.
8. Aesthetic and minimalist 3. Restrained. The Theme row stretches to 191 px per option at 1280, so cap it near 360 px above 600.
9. Error recognition and recovery 4. Each error says what happened and what to do.
10. Help 3. Every action carries a one-line scope caption.

Total 30/40.

**Detector.** The run with `NODE_PATH` came back DEGRADED, because ESM imports ignore `NODE_PATH`. A scratch copy with presentation-sites' `node_modules` linked gave the full run.
- Account light and dark: `cramped-padding` ×3 on `ul.rows` and its items (dismissed: 48 px rows, text centred, a hairline list), `repeating-stripes-gradient` ×1 (dismissed: the ruled hazard band in the shared CSS).
- Sign-in light and dark: `flat-type-hierarchy` 12/14/16 (dismissed: it skips the `clamp()` h1 at 32 px), stripes (dismissed).
- Console light and dark: `cramped-padding` on `.cs-th` (dismissed: a compact 40 px header), stripes (dismissed).
- Direction: `low-contrast` ×4 is **real** (priority 1, confirmed by hovering). `cramped-padding` ×7, `gpt-thin-border-wide-shadow` (the shadow-lg specimen box) and `repeated-container-text` "Hover" ×2 are specimen false positives. `em-dash-overuse` is the app's own copy, already ruled.

Don't dilute the islands or the pass, with Sign out kept in it, while fixing this. Density comes back through spacing and breakpoints, never by flattening cards, moving Sign out back or cutting copy.
