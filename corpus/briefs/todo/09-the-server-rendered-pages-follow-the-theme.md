# Brief 09 — The server-rendered pages follow the theme

**Depends on:** nothing. **Runs after:** brief 07 (the sign-in page's current look) and brief 05 (the Light / Dark / System switch).

**Before you start:** run `brief-board guide` ([CLAUDE.md](../../CLAUDE.md)).

Promoted 2026-11-19 from the todo of 2026-11-11 ([todos/the-oidc-pages-follow-the-theme.md](../../todos/the-oidc-pages-follow-the-theme.md)), in the owner's backlog grill. The calls are technical defaults settled on 2026-11-13 (the backlog grill, answer 3) and 2026-11-19.

## Context

Brief 05 gave the sign-in pages a Light / Dark / System switch, kept on the device: `localStorage` key `theme` (`ui/src/theme.ts`), applied before the first paint by the inline script in `ui/index.html`. Brief 07 redesigned the pages; their colours are the `--ward-*` tokens (`ui/src/styles/theme.css`).

Two pages are rendered by the API itself and carry their own inline light style, so someone who chose Dark sees a light page between two dark ones:

- `plainPage` (`api/src/oidc/provider.ts` ~112): the OIDC flow's error and expired pages;
- the register route's page (`api/src/features/register/routes.ts` ~752).

The API and the sign-in pages share an origin (`config.ts` requires `WARD_UI_URL` and the issuer to), so these pages can read the same `theme` key.

## Decisions

- **One shared page shell** for both, in the API, with the redesign's colours for light and dark as custom properties in its inline style (the `--ward-*` values from `theme.css`, light and dark, copied with a comment naming their source), and `<meta name="color-scheme">`.
- **The same inline boot script as `ui/index.html`**: reads `theme` (`light` | `dark` | `system`), light on a first visit, follows the system while the choice is System, sets `data-theme` on `<html>` and the `color-scheme` meta before the first paint. No cookie, no request.
- **CSP:** Ward sends no `script-src` today. If one is ever added, both inline scripts (this one and `ui/index.html`'s) need a hash or a move to a file; say so in a comment beside the script.
- No route, cookie, token or body change other than the pages' HTML.

## Files you OWN

- `api/src/oidc/provider.ts` (`plainPage`), `api/src/features/register/routes.ts` (its page), a new shared module for the page shell if both use it, and their tests.
- Corpus: `wiki/status.md`, `log.md`, the todo (delete it at closeout).

## Files you must NOT touch

- `ui/` (the sign-in pages): read only, for the script and the tokens.

## What to do

1. The shared shell with the two palettes, the meta and the boot script; both pages use it.
2. Tests: the rendered HTML carries the boot script, both palettes and the meta; titles and bodies are still escaped; the register page's content is unchanged apart from the shell.
3. Shots: render each page's HTML to a file and open it in headless Playwright at 1280 and 390, with `localStorage.theme` unset (light), `dark`, and `system` with a dark system; read each.

## Acceptance

- [ ] Both pages follow the saved choice before the first paint, light on a first visit.
- [ ] The tests above pass; `npm run check` exit 0; `bash corpus/lint.sh` OK.
- [ ] End move `ready_for_deploy`, owner step `node cli.ts ward server`.
