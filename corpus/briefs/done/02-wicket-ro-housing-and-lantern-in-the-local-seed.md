# Brief 02 — Wicket, ro-housing and Lantern in the local seed

## Context

Three apps that sign in through Ward aren't in the local seed
(`infrastructure/local/seed.mjs`, `APPS`), so "Sign in with Ward" can't be
tried against the local Ward for them:

- **Wicket** (the estate's LLM queue, built 2026-11-04). Its
  `docs/owner-setup.md` asks for this entry, word for word.
- **ro-housing** (made ready for the VPS on 2026-11-04). Its
  `docs/owner-setup.md` asks for the same.
- **Lantern** (a film-rating app, its first version built from 2026-11-04).
  Its dev server is on port 5180 and its API is under `/lantern-api`, the
  same shape as the others (decided 2026-11-04; 5180 was free across the
  estate that day).

Both repos left the entry as an owner step only because agents were kept out
of this repo during their runs.

## Files you OWN

- `infrastructure/local/seed.mjs` (`APPS`)
- `infrastructure/local/README.md` (the app table)
- `corpus/wiki/status.md`, `corpus/log.md`

## Files you must NOT touch

- Any app's repo, apart from what `seed.mjs` itself writes into an app's
  `.env` when it runs.
- `~/.config/ward/local.env` and any password. Don't read or print them.

## What to do

1. Add to `APPS`, in the style of the entries already there:

   ```js
   { slug: "wicket", name: "Wicket", repo: "wicket", envFiles: [".env"], dev: "http://localhost:5179/wicket/", api: "/wicket-api" },
   { slug: "ro-housing", name: "ro-housing", repo: "ro-housing", envFiles: [".env"], dev: "http://127.0.0.1:5173/ro-housing/", api: "/ro-housing-api" },
   { slug: "lantern", name: "Lantern", repo: "lantern", envFiles: [".env"], dev: "http://localhost:5180/lantern/", api: "/lantern-api" },
   ```

   Check each against its repo's dev config first (Vite port and base, the
   API prefix in the dev proxy). If one differs, follow the repo and say so.
   Lantern's checkout may not have its dev config yet when you start; use
   the values above.
2. Add their rows to the README's table.
3. If the local Ward container is running and `node seed.mjs` can run
   without asking for the owner's credentials (stdin closed, no
   `WARD_OWNER_*` set by you), run it. It is safe to re-run, keeps the keys
   already in place and changes nothing else in an app's `.env`. If it asks
   for credentials, stop it and leave the run as an owner step.

## Acceptance

- `node --check infrastructure/local/seed.mjs` passes, and the README table
  lists the three apps.
- Either the seed ran (each of the three `.env` files gained the five
  `WARD_OIDC_*` lines) or the owner step says exactly what to run.

## Outcome (2026-11-04)

`APPS` in `infrastructure/local/seed.mjs` has the three entries exactly as
above, and the local README's table has their rows. The README now says the
seed registers ten apps, not seven. `node --check` passes.

Checked against each repo, read-only:

- **Wicket**: `web/vite.config.ts` serves `/wicket/` on 5179 (strict port) and
  proxies `/wicket-api`. Its `.env` is at the repo root and gitignored. Its
  `docs/owner-setup.md` asks for this entry word for word.
- **ro-housing**: `web/vite.config.ts` serves `/ro-housing/` on 5173 and
  proxies `/ro-housing-api`; the API's default `PUBLIC_ORIGIN` is
  `http://127.0.0.1:5173`, hence the `127.0.0.1` host. Ward accepts an http
  redirect URI on any 127.0.0.0/8 host (`api/src/oidc/clients.ts`). `.env` is
  gitignored but doesn't exist yet.
- **Lantern**: no dev config yet. Its corpus (decisions, 2026-11-04) has
  `/lantern/` on 5180 and `/lantern-api/`, matching the brief. `.env` is
  gitignored but doesn't exist yet.

**The seed didn't run.** The local container was up and healthy, but
`node seed.mjs </dev/null` stops before it contacts Ward: with no
`WARD_OWNER_USERNAME` and `WARD_OWNER_PASSWORD` and no terminal, it asks for
them ("set WARD_OWNER_USERNAME and WARD_OWNER_PASSWORD, or run this in a
terminal to be asked"). It wrote nothing. Owner step:

1. In ro-housing and in Lantern, copy `.env.example` to `.env` at the repo
   root (Wicket has one). Otherwise the seed creates a `.env` that holds only
   the Ward lines, and a later copy of the example overwrites them.
2. In this repo's `infrastructure/local/`, in a terminal, run
   `node seed.mjs` and answer with the owner account. Each of the three
   `.env` files gains the five `WARD_OIDC_*` lines; the seven apps already
   seeded keep their keys.
