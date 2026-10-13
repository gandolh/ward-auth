---
summary: Two questions the 2026-10-13 OIDC redesign leaves for its briefs to settle — how an app authenticates as a client given app keys are stored hashed, and what oidc-provider's own session still does once Ward's refresh family is the authority.
updated: 2026-10-13
---

# Open Questions

Only what is actually open. The moment one is answered, **delete it from this
page** — the history belongs in [../log.md](../log.md) and the outcome in the
decisions pages.

## Open — settled inside brief 18

Both come from the 2026-10-13 redesign ([decisions-oidc.md](./decisions-oidc.md)).
Neither blocks writing code; brief 18 answers them and deletes them from here.

- **How an app authenticates as an OIDC client.** Ward stores app keys only as
  `sha256`, and `client_secret_basic` compares plaintext. `private_key_jwt` is
  preferred because Ward then holds no app secret at all. The fallback is a
  custom check of a hashed secret.
- **What oidc-provider's own session still does.** Ward's refresh family is the
  authority on "signed in at Ward", carried to apps as `ward_sid`. The
  provider's session must not outlive it or answer differently.

An empty page here is the goal state, not a gap.

## Not open — deferred to briefs

Work, not decisions:

- **The cutover.** Take a database copy first, then prune, then recreate.
  Atrium's repo has the `backup-pre-brief35-*` precedent.
- Rollout order; EdDSA key rotation procedure.
- The repo rename `wzd_auth` → `ward`, the `vps-deploy` entry, the `/ward-api`
  and `/ward` Caddy routes.
- UI stack — Vite + React, as the estate's other SPAs. prm already ships
  `reset_token` and `verification_token`; crib the email flow rather than
  inventing it.

## Not ours

- **Newspapper's now-exposed calls** — public `/uploads/*` and the IP-keyed
  lockout. Ward replaces its cookie; those two need a revision note in
  newspapper's own corpus.
- **Atrium's `HOST=0.0.0.0`** — binds all interfaces, so "Caddy is the only way
  in" rests on the firewall alone.
