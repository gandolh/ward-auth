# Brief 08 — Continue as, or use another account

**Depends on:** nothing. **Runs after:** brief 07 (the sign-in page's current look).

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

## Context

When an app sends someone to Ward and Ward's refresh cookie names a live session, `GET /refresh/oidc/:uid` finishes the authorization at once (`api/src/oidc/interaction.ts`). Signing out of an app does not end the Ward session, so "Sign in with Ward" after a sign-out puts the same person straight back in, with no way to pick another account short of opening Ward and signing out there.

The owner asked on 2026-11-17 for Google's behaviour: the button lets you choose the account.

## Owner decisions

- 2026-11-17: the chooser shows **every time** Ward already knows the browser, not only after an app sign-out. It is Ward's alone: no app, and no `ward-auth` library version, changes.

## The design

One function decides what an interaction gets, from the interaction and the browser's Ward session:

| Mode | When | What happens |
|---|---|---|
| `form` | no live session, or `prompt=login` / `max_age` not met | the login form, as today |
| `finish` | the session was born during this interaction (its `authTime` is not before the interaction's `iat`), or the person chose Continue | the grant checks and the redirect to the app, as today |
| `choose` | anything else | Ward's login page with `&choose=1`: "Continue as <name>" or "Use another account" |

- **Continue** is `GET /refresh/oidc/:uid/continue`, the resume route with the choice made (a path, not a query, so nothing is hand-parsed). It only upgrades `choose` to `finish`: a `form` interaction still gets the form. A GET, like the resume route it reuses; the provider's interaction cookie is still required, so a link from elsewhere lands on "this sign-in has expired".
- **Use another account** is the plain form (`/login?oidc=<uid>`). Signing in there replaces the refresh cookie exactly as signing in at Ward does today; the earlier session is not revoked, as today.
- `GET /refresh/oidc/:uid/client` adds `account`: the session's username when the interaction's mode is `choose`, otherwise `null`. Additive; the page needs it for the name.
- The page under `choose=1` shows nothing until `/client` answers, then the chooser with focus on Continue. If `account` comes back `null` (the session ended meanwhile), it shows the form.

## Files you OWN

- `api/src/oidc/interaction.ts`, `api/src/oidc/layout.ts`, `api/src/oidc/oidc.test.ts`, and the flow walker in `shared-library/src/fastify/ward.test.ts` (a test file: no library version)
- `ui/src/pages/Login.tsx`, `ui/src/lib/oidc.ts` and its test, `ui/src/components/looks.ts` (the chooser's two buttons)
- `corpus/wiki/decisions-oidc.md`, `corpus/log.md`, this brief

## Files you must NOT touch

- `shared-library/` outside its tests (no version bump, no re-vendor), cookies (`api/src/auth/cookie.ts`), token formats, error bodies.

## Acceptance

- [x] With a Ward session older than the interaction, the flow stops at `/login?oidc=<uid>&choose=1`; `/continue` then finishes it and names that session in `ward_sid`.
- [x] Signing in through the form inside the interaction finishes without the chooser.
- [x] `prompt=login` with an old session still asks for the password, and `/continue` does not skip it.
- [x] Use another account → a sign-in as someone else issues a code for that other account.
- [x] No grant and disabled account still end in `access_denied` after Continue.
- [x] `/client` answers `account` with the username in `choose` mode, `null` otherwise.
- [x] A real browser walk on a local Ward: chooser, Continue, Use another account, Back to the app.
- [x] `npm run check` passes and `bash corpus/lint.sh` ends clean.

## Outcome

Built 2026-11-17 on `main`, committed, not pushed.

- **API.** `interactionMode` in `api/src/oidc/interaction.ts` decides `form`, `finish` or `choose`; `GET /refresh/oidc/:uid` and the new `GET /refresh/oidc/:uid/continue` share one handler (`resume`). `chooserUrlFor` in `layout.ts` builds `/login?oidc=<uid>&choose=1`. `/client` answers `account` (the username in `choose` mode, else `null`).
- **UI.** `Login.tsx` under `choose=1` renders nothing until `/client` answers, then "Signed in to Ward as <name>" with "Continue as <name>" (focused, so Enter continues) and "Use another account" (shows the form). Two new full-width looks, `choose` and `chooseOther`, wrap a long name instead of overflowing.
- **Tests.** `oidc.test.ts`: the flow walker knows the chooser; `ageSessions()` puts a session a minute in the past, because the provider's whole-second clock otherwise counts a session from the same second as signed in during the interaction. New: Continue names the session, another account through the form, no grant after Continue, and `prompt=login` that Continue cannot skip. The library's own walker in `ward.test.ts` presses Continue, which is what its silent flows meant before.
- **Walk.** Dev API and UI on a scratch database (an app `shelfmark`, two accounts, a client): form with no session, chooser offering `ana`, another account as `mihai`, Enter on "Continue as mihai", Back to the app. The audit log shows `oidc.authorize` ana, mihai, mihai and `oidc.denied` cancelled; no 5xx.
- **Not checked.** The phone width of the chooser in a browser (the looks wrap, the card is the sign-in card's); the local Docker Ward was not rebuilt (Docker Desktop was not running).
- **Surface.** One new route, one new body field; cookies, tokens, error bodies and `shared-library/` unchanged, so no app re-vendors.
