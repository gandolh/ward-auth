---
summary: Dated snapshot (2026-11-11) of Ward, per area — the service (2026-09-04), in production since 2026-10-04, POST /notify (2026-10-07), the OIDC redesign and the old contract's retirement (2026-10-13, deployed), its own host (2026-10-22, live), the docs site on Docusaurus and the console work of 2026-10-23 to 11-04 (not deployed), the local seed's ten apps, the house style and npm run check (2026-11-11, not deployed), ward-auth 0.7.1 and which version each app vendors; the owner's next steps and known gaps.
updated: 2026-11-11
---

# Status — 2026-11-11

`origin/main` is at `a5520e3`; the commits after it (briefs 01 and 02, built
2026-11-04) are local. Brief numbering restarted at 01 on 2026-11-02
(see [../log.md](../log.md), "Briefs reset"). Four briefs were written on
2026-11-10: the house style and quality harness (03, built 2026-11-11, local
and not deployed), Base UI by the conventions (04, built 2026-11-11, local and
not deployed), the UI to Tailwind (05)
and the server in the house code structure (06). They follow the owner's estate calls of 2026-11-09
and were revised the same day to the answers of the grilling of 2026-11-10; a
fifth, a redesign with Hallmark on the estate board (07), was added then. Ideas waiting to be specced are in
[../todos/](../todos/).

## By area

- **The service** (2026-09-02 to 2026-09-04). Fastify + SQLite API, one login
  page, registration with email verification, self-service, and the
  break-glass console ([decisions-implementation.md](decisions-implementation.md),
  [decisions-admin.md](decisions-admin.md)).
- **Production** (since 2026-10-04). `vps-deploy`'s Ward stack deploys it; the
  cutover pruned and recreated every account through each app's own migration.
- **App mail** (2026-10-07). `POST /notify`: an app mails its own users through
  Ward without reading an address ([decisions-app-keys.md](decisions-app-keys.md)).
  imbatranimOS left Ward the same day; its app row is still in the deployed
  database until the owner deletes it.
- **The OIDC redesign** (2026-10-13, deployed). Every app keeps its own accounts
  and login page; "Sign in with Ward" is a code flow with PKCE and
  `private_key_jwt` against Ward's provider; a Ward-originated session is
  checked through `POST /session-status` every 30 seconds. The shared library
  carries both halves; atrium, newspapper, prm, sports-app and satchel moved to
  local accounts; the lockout learned trusted proxies after a shared-bucket
  outage behind containers; just-a-bot's Jukebox signs in to atrium itself
  ([decisions-oidc.md](decisions-oidc.md),
  [decisions-oidc-build.md](decisions-oidc-build.md)).
- **The old contract retired** (2026-10-13, deployed the same day). App keys,
  `POST /introspect`, the `Path=/` cookie (now `Path=/ward-api`, with the old
  copy expired on every response), the `?next=` estate list and the reference
  client are gone ([integrating.md](integrating.md)).
- **Ward's own host** (2026-10-22, live; found 2026-10-24). The UI at the root
  of `ward.<domain>`, the API at `/ward-api`, the issuer
  `https://ward.<domain>/ward-api/oidc`; `/ward/*` redirects
  ([decisions.md](decisions.md)).
- **Docs site** (2026-10-19, not deployed). Docusaurus at `/ward/docs` with the
  same URLs; every wiki page is published. `vps-deploy` flipped the docs stack
  to Docusaurus the same day.
- **The console** (2026-10-23 to 2026-10-27, not deployed). Base UI under
  `Confirm` and the create forms; rename and delete an account, stopping at
  Ward's edge; the console in a lazy chunk, so the sign-in pages no longer
  download Base UI (entry JS 120.07 → 81.45 kB gzip); focus after a confirmed
  write goes to the opener or the heading. On 2026-11-04 the writes with no
  confirmation got the same rule (not deployed): adding or removing a role
  lands on the Access panel's heading, a save on its button or, when the
  button is disabled after the reload, the heading.
- **The local Ward** (`infrastructure/local/`). Its seed lists ten apps since
  2026-11-04: Wicket, ro-housing and Lantern joined the seven. The seed hasn't
  run for the three yet; it needs the owner's credentials (Next, below).
- **The house style** (2026-11-11, not deployed). Prettier at 120, the house
  tsconfig flags and ESLint config from `vendor/house-style/` (1.1.0), and
  `npm run check` as the gate, with `check:fast` for the Stop hook
  ([decisions-implementation.md](decisions-implementation.md)). Both
  convention checkers run `--warn-only` until the UI and server work.
- **ward-auth** (`shared-library/`, 0.7.1 on 2026-11-11). 0.4.0 renames a user,
  0.5.0 shapes a new Ward user's name, 0.6.0 disables a local user, 0.6.1
  exports the new names, 0.7.0 keeps a refused sign-in's return path, 0.7.1
  is the house style with no change for apps. Vendored
  (read 2026-11-02): 0.7.0 in sports-app, 0.4.0 in shelfmark, 0.3.1 in atrium,
  newspapper, prm, satchel and almanac. Each app adopts a version itself.

## Next (owner)

- **Deploy Ward** (`node cli.ts ward all` in `vps-deploy`): ships the console
  work and the docs site; `node cli.ts ward deploy` ships the house-style
  commits.
- **Have git blame skip the reformat:**
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- **Re-vendor ward-auth** in the apps that want 0.4.0 to 0.7.0; the comment-only
  source changes of 2026-11-02 reach them with the next vendor run.
- **Delete imbatranimOS's app row** in the deployed database.
- **Run the local seed** for Wicket, ro-housing and Lantern, in a terminal,
  since it asks for the owner account: `node seed.mjs` in
  `infrastructure/local/`. In ro-housing and Lantern, copy `.env.example` to
  `.env` first, or the seed creates a `.env` holding only the Ward lines.

## Known issues

- **Two tests time out on a busy machine**: `api/src/config.proxies.test.ts`
  and `config.oidc.test.ts` boot a child process each and can pass 5 s when
  the load average is near 10. Alone they pass, and they did the same before
  2026-11-11. The vendored README test, failing since 2026-11-01, passes
  again (1236 of 1236).
- No error boundary for a failed console chunk load; only a full page load of
  `/console` fetches it, with a fresh `index.html`.

## What is actually known

- The estate is **one origin**, sub-paths only (Ward and three other apps on
  hosts of their own since 2026-10-22). This
  constrains every candidate design and is the single most load-bearing fact.
- **Six apps** have or will have identity: atrium and newspapper (the two named
  in the request), plus public-resource-map, imbatranimOS, sports-app and
  eventually trips. Designing for two under-counts.
- Atrium and newspapper **disagreed on every row** of the auth model. Settled by
  the cutover: Ward's shape won each one, and each app's revision notes record
  what it gave up.
- Newspapper's **loopback premise is retired**. Its `/uploads/*` exposure was
  closed by intercepting the request rather than authorising it — see that
  repo's `decisions-security.md`.
- prm's public signup **collided with the no-public-signup decision** (Q8). That
  is what moved the estate's boundary from registration to authorization, and
  prm remains the only app with the flag on.

## The shape

**Until 2026-10-13**: apps redirected to one central
`/ward/login`, verified a 15-minute EdDSA access token in a `Path=/` cookie,
and asked `/introspect` with their app key whether the session was live,
caching the answer 30 seconds.

**Now:** Ward is a Fastify + SQLite container at `/ward-api` with a Vite +
React UI at the root of its own host (at `/ward` until 2026-10-22). It owns Ward accounts and **grants**; its own cookies are
scoped to `/ward-api`. Each app owns its accounts and sessions, and local
sign-in never calls Ward. "Sign in with Ward" is a code flow with PKCE and `private_key_jwt`
against Ward's provider at `/ward-api/oidc`. A Ward-originated session is
checked through `POST /session-status` every 30 seconds and fails closed. A
grant still decides who may use the button; the app owns the role. The shared
code is a built, unminified library each app copies into `vendor/ward/`.

## What changed most

Q12 moved the estate's security boundary from **registration** to
**authorization**. Anyone may hold a Ward account; a grant is what lets them
reach anything. That revised two Round 1 decisions and pulled public signup —
with its abuse and recovery costs — into scope. It is the right shape, and it is
also the single largest source of remaining work.

## Known gaps in this corpus

- ~~No `architecture.md`, `api.md` or `data.md`.~~ **Closed 2026-09-06** — not in
  the corpus but in `docs/`, a docs site at `/ward/docs` (Docusaurus since
  2026-10-19). Architecture, the HTTP surface, the data model, configuration
  and app keys are authored there against the code; this corpus is *rendered*
  into the same site rather than duplicated, and `.env.example` stays the
  canonical variable list.
- The research in [landscape.md](./landscape.md) is a survey of published
  comparisons, not hands-on evaluation. Nothing has been installed or measured.
  It documents a road not taken and should not be re-opened casually.
- **The integration gap is closed but narrow.** Nine tests drive the real
  `buildApp()` against a real database and a real key — happy paths and
  revocation, not the mail flow, not a browser, nothing concurrent beyond the
  one refresh race.
- **Two behaviours only the integration suite could see**, both recorded in
  code where they surfaced: the 10-second refresh race carve-out swallows a
  replay that fires too soon, and `session.refresh_denied` is effectively
  unreachable for the everyday disabled account because `/refresh` peeks the
  token's session before the rotation that would write the row.
- **Two review passes per wave have each found bugs the gates could not.** Every
  wave so far shipped at least one Critical or Important defect that typecheck,
  lint and a green suite all missed — the signing key being committable, the WAL
  checkpoint, the verify options bag, the multi-tab refresh. Budget for review as
  part of the work, not as a formality after it.
- The 2026-09-06 integrations changed **other repos'** locked decisions and owed
  revision notes there: atrium's D30 and D35, and newspapper's three security
  calls.
