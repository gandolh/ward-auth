---
summary: What is genuinely open (nothing, as of brief 18), work deferred to briefs, and items that belong to other repos.
updated: 2026-10-13
---

# Open Questions

Only what is actually open. The moment one is answered, **delete it from this
page** — the history belongs in [../log.md](../log.md) and the outcome in the
decisions pages.

## Open

Nothing. An empty page here is the goal state, not a gap.

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
