# Brief 04 — Base UI by the conventions

**Depends on:**

- In ward-auth: brief 03, for the gate, the formatter and `.claude/rules/ui.md`.
- In the owner's skills library:
  - brief 02, *A base-ui skill, styled with Tailwind*: rules 1-13, the references and `check-base-ui.mjs`;
  - brief 15, *Enforce the base-ui and code-structure skills in every repo*: the checker runs `--warn-only` until brief 05 here is done.
- The owner's grilling of 2026-11-10: Q15 (Base UI only under `ui/`), Q16 (where native controls stay) and the new questions in decisions 2-4.

**Runs before:** 05. This brief moves structure; brief 05 changes only the styling, so its before and after screenshots compare like with like.

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

On 2026-11-09 the owner decided Base UI 1.9.0 everywhere, with the base-ui skill's conventions enforced in each repo. ward-auth adopted Base UI on 2026-10-23, in the console only, under one decision, "The console's widgets are Base UI; the public pages import none" ([wiki/decisions.md](../../wiki/decisions.md)). It is already close to the conventions. This brief closes the few gaps the audit below found, **and keeps that decision's first half exactly**: the sign-in pages download no Base UI. The decision's second half, "styled by `console.css`", is brief 05's to revisit.

### The pin (verified 2026-11-10)

- `ui/package.json:14` pins `"@base-ui/react": "1.9.0"`; no other `package.json` names it.
- `package-lock.json` resolves `node_modules/@base-ui/react` at 1.9.0, with `@base-ui/utils` 0.5.0.
- No file uses the names 1.9.0 renamed (`OTPFieldPreview`, `otp-field`, `sanitizeValue`).

**No bump brief is needed.**

### Where Base UI sits today

Three files import it, all under `ui/src/pages/console/`, all by subpath:

| File:line | Import | Used for |
|---|---|---|
| `ui/src/pages/console/ui.tsx:21` | `@base-ui/react/alert-dialog` | `Confirm` (lines 205-283): `AlertDialog.Root`, `Portal`, `Backdrop`, `Popup`, `Title` |
| `ui/src/pages/console/Accounts.tsx:18` | `@base-ui/react/collapsible` | the new-account form: `Root` (37), `Trigger` (41), `Panel` (53), closing at 61 |
| `ui/src/pages/console/Apps.tsx:27` | `@base-ui/react/collapsible` | the new-app form: `Root` (50), `Trigger` (54), `Panel` (66), closing at 75 |

`Confirm` has 12 call sites: `ui/src/pages/console/AccountDetail.tsx:330, 361, 389, 424, 455, 490, 677, 695`, `ui/src/pages/console/AppDetail.tsx:360, 392, 428`, `ui/src/pages/console/Apps.tsx:294`.

**The chunk boundary, measured 2026-11-10** on a scratch build (`npx vite build` in `ui/`, sourcemaps on): the entry chunk's map lists 28 sources and **none** from `@base-ui`; the lazy console chunk's map lists 103 of its 124 sources from `@base-ui`. Entry JS is 257.22 kB (81.45 kB gzip), console JS 136.68 kB (40.90 kB gzip). The lazy import is `ui/src/app.tsx:19-21`. The checks below use these maps.

### The audit against rules 1-13 (2026-11-10)

| Rule | Violations | Where |
|---|---|---|
| 1. Exact pin | 0 | |
| 2. Subpath imports | 0 | All 3 imports are subpaths. |
| 3. Base UI only under a `ui/` folder | **3** | The three files above. `ui.tsx` is a file named `ui`, not a folder, and it also holds 380 lines of non-Base-UI pieces (`TextField`, `Panel`, notices). |
| 4. Tailwind on the parts, no class selector aimed at a part | `wc-dialog`, `wc-dialog-backdrop`, `wc-dialog-actions` and the trigger's `wc-btn` | `ui/src/pages/console/console.css:680-718`. **Brief 05's work.** |
| 5-7. One stylesheet, semantic tokens, motion | all of them | **Brief 05's work.** One inline `style` prop exists: `ui/src/app.tsx:102` (the loading line's padding). |
| 8. Floating parts portalled, z from tokens | 0 | `Confirm` uses `AlertDialog.Portal` (`ui.tsx:249`); it sets `data-ward-surface="console"` on the popup (line 256) because the portal lands outside the console wrapper and would otherwise take the light sign-in tokens. That attribute is a ward-auth fact to keep. |
| 9. Trigger around a component uses `render` | 0 | The two `Collapsible.Trigger`s hold text only (`Accounts.tsx:41`, `Apps.tsx:54`). |
| 10. `Select.Root` with `items` | 0 | No Base UI `Select`. |
| 11. No `window.confirm`, `alert` or `prompt` | 0 | `grep -rnE "window\.(confirm\|alert\|prompt)\|\bconfirm\(" ui/src --include=*.tsx` prints nothing. |
| 12. Dialogs | **1 to check** | `Confirm` has a controlled `open`, the Escape guard (`onOpenChange` ignores a close while `busy`, lines 245-247), a `Title` (260), `finalFocus` set deliberately (257), and no outside-press dismissal (an alert dialog never has one). It sets no `initialFocus`; the focus order is Base UI's default (Cancel first, per the comment above the function). The skill's confirm pattern may name an order; step 3 compares and records an exception if they differ. The one icon-only control, the role `×` (`AccountDetail.tsx:837`), has an `aria-hidden` glyph; step 4 confirms its button carries an `aria-label`. |
| 13. Base UI over hand-built widgets | **0 certain, 2 candidates** | See below. |

**Rule 13**, the widgets that aren't Base UI:

1. **Native `<select>`**, 4: `ui/src/pages/console/Audit.tsx:140, 166, 194` (the audit filters) and `ui/src/pages/console/AccountDetail.tsx:869` (the grant form's app). ward-auth records no decision keeping selects native. The console is dark, desktop-first and has one breakpoint (`@media (width <= 60rem)`, `console.css:828`). See decision 2.
2. **`<datalist>`**, 1: `AccountDetail.tsx:897-902`, the role suggestions for a free-text field, joined to the `TextField` through its `list` prop (`ui.tsx`, `TextFieldProps.list`). The comment at `AccountDetail.tsx:731` calls it a suggestion, not a constraint. See decision 3.

**Considered and left:**

- **Public pages** (`ui/src/components/Field.tsx`, `Notice.tsx`, `Threshold.tsx`, `ui/src/pages/Login.tsx`, `Register.tsx`, `Verify.tsx`, `Account.tsx`): hand-built form fields and notices. Rule 13 would send a text field to Base UI's `Field`/`Input`, and that would put Base UI JavaScript on the sign-in pages, which the decision forbids. The decision wins; record it in `scripts/conventions.json` if the checker flags it.
- **Live regions:** `ui/src/components/Notice.tsx:59`, `ui/src/app.tsx:102`, `ui/src/pages/console/ui.tsx:183`. They announce state. Base UI's `Toast` is a transient message and these are not.
- **The console nav** (`ui/src/pages/console/nav.ts`, `routes.tsx`): router links, not tabs.
- **`textarea`** ×3 in `OidcClient.tsx:123, 141, 158`: text input, native by rule 13.

## Owner decisions (defaults this brief builds)

1. **Where the wrappers live** (Q15). Default: the console's own `ui/src/pages/console/ui/`, one file per primitive: `Confirm.tsx` and `Collapsible.tsx`. The skill allows a feature's own `ui/` folder for a composite only that feature uses, and here the *only* user of Base UI is the console. Putting the wrappers under `ui/src/components/ui/` instead would sit them next to `Field.tsx` and `Notice.tsx`, one wrong import away from the sign-in pages. *New question for the grilling: should the physical boundary, rather than the checker alone, keep the sign-in pages clean?*
2. **Native selects** (Q16). Default: they stay native, and the reason is written into [wiki/decisions.md](../../wiki/decisions.md) in step 5, because rule 13 names selects only "where an app's decisions keep it native on phones" and ward-auth has no such decision. Reasons: they are four plain filters and a form field, with no custom rendering and values equal to their labels' meaning. *New question: confirm native, or move the four to Base UI's `Select`?* If moved, rule 10 applies (`items`), and the audit filter's empty "Anyone" option needs a value.
3. **The role suggestions.** Default: the `<datalist>` stays. *New question: is a free-text field with suggestions a candidate for Base UI's `Combobox` or `Autocomplete`, and is its extra weight in the console chunk acceptable?* Measure the chunk first if the answer is yes.
4. **The Confirm's focus order** (rule 12). Default: keep Cancel first, because a destructive confirm should not default to its action, and record it in `scripts/conventions.json` if the skill's `initialFocus` order differs.
5. **No change to `data-wc-focus`.** The focus-after-write rule (27 uses, `focus-after-write.ts` and its test) is a recorded decision. Nothing here touches it.

## Files you OWN

- `ui/src/pages/console/ui.tsx` (`Confirm` leaves it), the new `ui/src/pages/console/ui/Confirm.tsx` and `ui/src/pages/console/ui/Collapsible.tsx`, and their tests.
- The import lines and the `Collapsible` markup in `ui/src/pages/console/Accounts.tsx` and `ui/src/pages/console/Apps.tsx`, and the `Confirm` import in `AccountDetail.tsx`, `AppDetail.tsx` and `Apps.tsx`.
- `scripts/conventions.json`, for any exception.
- `.claude/rules/ui.md`: the Base UI lines.
- Corpus: [wiki/decisions.md](../../wiki/decisions.md) (the decision above, extended), [wiki/status.md](../../wiki/status.md), [log.md](../../log.md).

## Files you must NOT touch

- Behaviour and the look. Every class name stays as it is; brief 05 changes them.
- `ui/src/pages/console/focus-after-write.ts` and the `data-wc-focus` keys.
- The public pages and `ui/src/components/`: they import no Base UI before or after.
- `api/` and `shared-library/`.

## What to do

One commit per step, each with `npm run check` and `npm run build` green.

1. **Before.** Take the baseline the later steps compare against:
   - build `ui/` and record the entry chunk's and the console chunk's Base UI source counts, with the sourcemap command in Acceptance;
   - run `check-base-ui` strict and record its findings by rule (expect rule 3: 3, and the rule 5 findings that are brief 05's);
   - list the behaviour of each Base UI component as it is now, and keep the list for step 4.
2. **The `Collapsible` wrapper.** Create `ui/src/pages/console/ui/Collapsible.tsx` re-exporting `Root`, `Trigger` and `Panel` with a `className` pass-through (no styling yet). `Accounts.tsx` and `Apps.tsx` import it, and neither imports `@base-ui/react` any more.
3. **The `Confirm` wrapper.** Move `Confirm` and its `ConfirmProps` out of `ui.tsx` into `ui/src/pages/console/ui/Confirm.tsx`, unchanged line for line. Compare its focus order with the skill's confirm pattern (decision 4). Update the 12 call sites' import. `ui.tsx` keeps the rest and no longer imports Base UI.
4. **Behaviour checks.** Run the console's tests, then drive each in Chromium against a scratch API and database, not the shared container:
   - **`AlertDialog`:** opens from a button; focus lands on Cancel; Escape and Cancel close it and return focus to the opener; a press outside does nothing; while `busy`, Escape does nothing and both buttons are disabled; confirming moves focus to the popup, and after the write the screen places focus by its `data-wc-focus` key.
   - **`Collapsible`:** the trigger's label flips between "New account" and "Close the new-account form"; the panel is unmounted while closed (the form is empty each time it opens); a successful create closes it.
   - the role `×` button has an `aria-label` naming the role, found with `grep -n "aria-label" ui/src/pages/console/AccountDetail.tsx`.
5. **Checker and corpus.**
   - Run `check-base-ui` strict: rule 3 is clean, and the only findings left are brief 05's (rule 5).
   - Extend "The console's widgets are Base UI; the public pages import none" in [wiki/decisions.md](../../wiki/decisions.md): the wrappers' place, the native selects and the datalist with their reasons, the public pages as the rule 13 exception.
   - Update `.claude/rules/ui.md`, [wiki/status.md](../../wiki/status.md) and [log.md](../../log.md), and run `bash corpus/lint.sh` until it is clean.

## Acceptance

- [ ] `grep -rln "@base-ui/react" ui/src` prints only files under `ui/src/pages/console/ui/`.
- [ ] After `npm run build -w @ward/ui`, the entry chunk's sourcemap has no Base UI source:
      `node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(m.sources.filter(s=>s.includes("@base-ui")).length)' ui/dist/assets/index-*.js.map` prints `0`, and the same command on `ui/dist/assets/routes-*.js.map` prints a positive number.
- [ ] `check-base-ui` reports no rule 1, 2, 3, 9, 10, 11 findings; its remaining rule 5 findings are the CSS brief 05 deletes.
- [ ] Every Base UI behaviour in step 4 is checked, and the result is in the outcome note.
- [ ] The 12 `Confirm` call sites still compile and the console's tests pass unchanged: `npx vitest run ui`.
- [ ] `ui/src/pages/console/focus-after-write.ts` and its test have no diff (`git diff --stat HEAD~N -- ui/src/pages/console/focus-after-write*`).
- [ ] `npm run check` passes, and `bash corpus/lint.sh` ends clean.

## Interplay

- Brief 05 styles `Confirm` and `Collapsible` once, in their new files, so this brief must be done first.
- The skills library's brief 25 (the security audit) reads `ui/src/pages/console/`; moving `Confirm` changes paths in its findings, so run it before or after, not during.
- If the owner answers decision 2 or 3 with "move to Base UI", that is a new brief: it adds `Select` or `Combobox` wrappers and re-measures the console chunk.
