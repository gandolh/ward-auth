---
summary: Dated snapshot. The 2026-10-13 OIDC redesign is built — Ward's provider, the shared library, five apps on local accounts, the lockout fix and the Jukebox (briefs 18–26, 28, 29) — and brief 27 wrote the deploy config and the owner's runbook (docs/cutover-oidc.md). Production still runs the shared-cookie contract until the owner runs it; brief 30 retires the old contract afterwards.
updated: 2026-10-13
---

# Status

_2026-10-13._

## Where things stand

**The redesign is built and waiting for the owner's deploy.** Every app has
its own users, its own login page and a "Sign in with Ward" button, and Ward
is an OpenID Connect provider ([decisions-oidc.md](./decisions-oidc.md)). It
revises Q4, Q21 and the no-shared-package call.

| Wave | Briefs | State |
|---|---|---|
| A | 18 OIDC provider · 20 library: local accounts | **Done** |
| B | 19 session status for clients · 21 library: Sign in with Ward | **Done** |
| C | 22 atrium · 23 newspapper · 24 prm · 25 sports-app · 26 satchel, plus 28 lockout behind containers and 29 the Jukebox | **Done**; library 0.3.1 vendored in all five |
| D | 27 cutover config and runbook | **Written**; the deploy is the owner's |
| E | 30 retire the cookie contract | Starts only after the owner confirms production runs the new flow |

**Brief 27** put the new contract into vps-deploy. Ward gets
`WARD_OIDC_ISSUER`, `WARD_UI_URL` and `WARD_TRUSTED_PROXIES`. Each app gets its
public origin, the `WARD_OIDC_*` client settings and `AUTH_TRUSTED_PROXIES`.
Each app also loses `WARD_PUBLIC_ORIGIN`, `WARD_API_BASE_PATH` and
`WARD_APP_KEY`. The client key is a required secret in each app's
`secrets/<stack>.env`. The owner's command list, in order, is
`docs/cutover-oidc.md`. Back up Ward and the apps, deploy Ward, register five
clients in the console, deploy the apps, give the owner a local password in
each, then the Jukebox.

**Production today** is still the shared-cookie shape below
([integrating.md](./integrating.md)). A new Ward serves both flows, so the
apps can move one at a time. imbatranimOS stays out. The subdomain move is a
todo ([../todos/ward-on-a-subdomain.md](../todos/ward-on-a-subdomain.md)).

## History

- **2026-09-01 → 09-04, waves 1–6:** the service. API, `@ward/client`, one
  central login page with `?next=`, registration and verification,
  self-service and the superuser console.
- **2026-09-06:** app keys made `POST /introspect` non-anonymous
  ([decisions-app-keys.md](./decisions-app-keys.md)). Wave 8: five apps
  hand-wrote Ward clients against [integrating.md](./integrating.md) and
  deleted their own credentials.
- **2026-10-04:** the deploy and the cutover ran on production (owner). Brief
  11 was superseded by vps-deploy's `stacks/ward.ts`.
- **2026-10-07:** brief 17, `POST /notify`. imbatranimOS left Ward (its brief
  157). The deployed database still holds its app row until the owner deletes
  it.
- **2026-10-13:** the OIDC redesign, briefs 18–29 (above).

| Thread | State |
|---|---|
| Decisions | Five design pages plus [decisions-oidc.md](./decisions-oidc.md) and its build calls in [decisions-oidc-build.md](./decisions-oidc-build.md); engineering calls in [decisions-implementation.md](./decisions-implementation.md) |
| Open questions | **None** — [open-questions.md](./open-questions.md) |
| Name | **Ward** (repo still `wzd_auth`; rename deferred by the owner) |
| Briefs done | 00–10, 13–29 in [briefs/done/](../briefs/done/); 11 superseded |
| Briefs open | 30 (after the owner confirms). Brief 27's deploy is the owner's, per docs/cutover-oidc.md |
| Shared library | `shared-library/` 0.3.1, vendored into atrium, newspapper, prm, sports-app and satchel |
| Deploy entry in `vps-deploy` | Old contract deployed 2026-10-04; the new one is configured, not deployed |

## What is actually known

- The estate is **one origin**, sub-paths only. This
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

## The next move

The owner runs `docs/cutover-oidc.md`. After the owner confirms every app
signs in through the new flow, brief 30 removes app keys, `/introspect`, the
`?next=` list and `client/`.

## The old waves

| Wave | Briefs | What landed |
|---|---|---|
| 1–6 | 00–10 | The service, 2026-09-02 → 09-04 |
| 8 | 13 · 14 · 15 + 2 unbriefed | All five apps cut over, 2026-09-06, ahead of wave 7 |
| 7 | 11 | Superseded by `stacks/ward.ts`; deployed |
| 9 | 16 | The cutover, on production 2026-10-04 |

## The shape

**In production until the owner's deploy:** Ward is a Fastify + SQLite
container at `/ward-api` with a Vite + React UI at `/ward`. It owns
credentials, identity and **access grants**. Apps redirect to one central
`/ward/login`, verify a 15-minute EdDSA access token in a `Path=/` cookie, and
ask `/introspect` with their app key whether the session is live, caching the
answer 30 seconds.

**After it:** each app owns its accounts and sessions, and local sign-in never
calls Ward. "Sign in with Ward" is a code flow with PKCE and `private_key_jwt`
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
  the corpus but in `docs/`, a Starlight site at `/ward/docs`. Architecture, the
  HTTP surface, the data model, configuration and app keys are authored there
  against the code; this corpus is *rendered* into the same site rather than
  duplicated, and `.env.example` stays the canonical variable list.
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
- Two briefs change **other repos'** locked decisions and owe revision notes
  there: 13 (atrium D30 and D35) and 14 (newspapper's three security calls).
