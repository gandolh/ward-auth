# ward-auth: the controller's rulings (2026-11-13)

## Before the critic (from the build report)

1. **Em dashes in the app's copy** (lint gate 19, not waivable): the email line, the Change password hint and the console's break-glass line. End the sentence where the dash is (`None on record. This account was created from the console.`; `… This one stays signed in. It gets a fresh session automatically.`; the break-glass line likewise). Add a Decision sticky listing each copy edit, old and new, so the code brief changes the same strings. Not U+2012: that is for ranges in data, not prose.
2. The straight apostrophe in `estate's` becomes `’` in the comps (F1); note it on the same sticky.

## On the critique (round 2)

The critic (`ward-auth.md`) stands, with these calls:

3. **Disabled primary:** fix the hover leak (`.btn.primary:not([disabled]):hover`); check the lockout and pending states in both themes.
4. **The jamb on the phone (the critic's open question):** at 600 px and under, the jamb stops under the lede, and the sign-in card runs the full content width (about 350 px at 390). On wider screens the card hangs off the jamb as ruled. This keeps both halves of ruling 5: the jamb is Ward's, and no full-height rail narrows the phone.
5. **Account phone spacing:** take the critic's six max-width 600 rules (spacing only, no content moved); report the reach heading's y and whether the Password heading is on the first screen at 390x844.
6. **Console fold at 1000,** not 1100: the full table from 1000 up, two-line rows from 601 to 1000.
7. **Pass labels** at 12/16 in the faint text colour, 4 px above each value; the stacked layout stays.
8. **Also fix:** the console intro's lost margin (wrap the reset in `:where()`), the console column headings' 5-6 px offset, the white band under the console at 768x1024, and the Direction twin's console colours (re-shoot it).
9. Apply ruling 1-2 above (em dashes, apostrophe) if not yet done, re-run every Floor check from scratch, and report the first-screen checks at 1280x800, 390x844 and 360x800.

## Round 3 (controller's look, 2026-11-13)

10. **The pass on the phone lost its stack.** At 390 (and 360) `Username` and `alex` sit side by side, the small label dropped to the value's foot. Ruling 7 keeps the stacked layout at every width: the label at 12/16 faint, 4 px above the value, as at 1280. Win the space elsewhere if the reach heading moves (report its y at 390x844 and 360x800). Re-shoot the account twins and re-run the Floor.
