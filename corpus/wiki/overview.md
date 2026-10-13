---
summary: What Ward is — the estate's identity service and, since the 2026-10-13 redesign, the OpenID Connect provider behind every app's "Sign in with Ward" button, while each app owns its accounts — the shape in a paragraph, what the repo holds, and how to pick up the thread.
updated: 2026-10-13
---

# Overview

**Ward is the estate's identity service.** Since the redesign of 2026-10-13
([decisions-oidc.md](./decisions-oidc.md)), every app on the shared VPS owns
its own accounts and its own login page. Ward is a second way in, the OpenID
Connect provider behind each app's "Sign in with Ward" button. A person can
have a local account in an app, a Ward account, or both linked. Apps keep
working while Ward is down, because local sign-in never calls Ward.

The repo directory is still called `wzd_auth`; the service is **Ward**.

## The shape

Ward is a Fastify + SQLite service in a container at `/ward-api` on the shared
origin, with a Vite + React UI at `/ward`: the login page, self-service and
the superuser console. It owns Ward accounts and **grants**, which are
`(subject, app, role)` rows saying who may use the button for which app.

"Sign in with Ward" is an authorization code flow with PKCE against
[`oidc-provider`](https://github.com/panva/node-oidc-provider), mounted at
`/ward-api/oidc`. Each app's server is a confidential client that signs its
requests with its own Ed25519 key (`private_key_jwt`). Ward completes the flow
only for an account with a grant for that app. The app creates or finds the
linked local user and owns its role from then on.

**Revoke-everywhere survives for Ward-originated sessions.** The app asks
`POST /session-status` at most every 30 seconds whether the Ward session (the
refresh family) is still live and the grant still held. When Ward cannot
answer, the session is refused. Local sessions are never checked against Ward.

The shared logic (passwords, lockout, sessions, the Ward client, linking) is a
built, unminified library in `shared-library/`. Each app copies it into
`vendor/ward/` and builds its own screens on its unstyled hooks.

## What the repo contains right now

- `api/`: the service, including the provider (brief 18) and the old
  shared-cookie contract (app keys, `/introspect`), which stays until brief 30.
- `ui/`: the login page, self-service and the console, with a "Sign in with
  Ward" panel per app for its redirect URIs and public key.
- `shared-library/`: the library, at 0.3.0, vendored into atrium, newspapper,
  prm, sports-app and satchel.
- `client/`: the old reference client, retired by brief 30.
- `docs/`: the Starlight site at `/ward/docs`, and `docs/cutover-oidc.md`, the
  owner's runbook for taking the redesign to production (brief 27).

The deploy lives in vps-deploy (`stacks/ward.ts` and each app's stack).
Production still runs the shared-cookie contract until the owner runs the
runbook. [status.md](./status.md) has where things stand.

## Where the thread is

1. [estate.md](./estate.md) — what already exists. Read this first; it is
   findings, not opinion, and several candidate designs are ruled out by the
   topology alone.
2. [landscape.md](./landscape.md) — the candidate answers, researched
   2026-09-01: forward-auth gateways, full OIDC providers, or an owned service.
3. The decisions — [decisions.md](./decisions.md) (topology, ownership, naming),
   [decisions-accounts.md](./decisions-accounts.md) (registration, grants,
   identifier) and [decisions-tokens.md](./decisions-tokens.md) (sessions,
   tokens, revocation). Most obvious alternatives were considered and rejected
   there, with reasons.
4. [decisions-implementation.md](./decisions-implementation.md) — the calls
   made *while building*: the storage driver, password hashing, the bind
   address, and why closing the database is a backup decision.
5. [decisions-oidc.md](./decisions-oidc.md) and
   [decisions-oidc-build.md](./decisions-oidc-build.md) — the 2026-10-13
   redesign this page describes, and the calls made building it. They revise
   parts of the pages in item 3, each with a dated note.
6. [open-questions.md](./open-questions.md) — deliberately empty. The design
   was settled across six rounds; the page is kept so the next open question
   has somewhere to land.

## The one thing worth knowing before reading anything else

Every project is a **sub-path on a single origin** (the production domain). There
are no subdomains. That made a shared session cookie nearly free and makes
isolation between apps impossible — the browser treats `/atrium` and
`/design-study` as the same security context. Most of the interesting design
tension in this repo traces back to that one fact. The OIDC redesign stops
depending on it: nothing in the flow assumes Ward shares an app's origin, so
Ward can move to a subdomain later.

## Naming

A ward is a protective enchantment on a threshold — it *is* access control, and
it keeps the estate's architectural naming (Atrium, Citadel, Hollow). The
working name `wzd_auth` was retired because `wzd` is *newspapper's markup file
extension*, which named the estate's identity service after one app's file
format.
