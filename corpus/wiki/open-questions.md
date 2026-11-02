---
summary: What is genuinely open (nothing, as of 2026-10-13), work deferred until someone files it, and items that belong to other repos.
updated: 2026-11-02
---

# Open Questions

Only what is actually open. The moment one is answered, **delete it from this
page** — the history belongs in [../log.md](../log.md) and the outcome in the
decisions pages.

## Open

Nothing. An empty page here is the goal state, not a gap.

## Not open — deferred

Work, not decisions:

- **The signing-key rotation procedure.** `api/src/tokens/keys.ts` already
  verifies with a previous key beside the current one; no runbook says when
  and how to rotate.
- **The repo rename** `wzd_auth` → `ward`, deferred by the owner.

Done since this list was written: the cutover (2026-10-04, through each app's
own migration, after a database copy), the `vps-deploy` entry and its routes,
and the Vite + React UI.

## Not ours

- **Newspapper's now-exposed calls** — public `/uploads/*` and the IP-keyed
  lockout. Ward replaces its cookie; those two need a revision note in
  newspapper's own corpus.
- **Atrium's `HOST=0.0.0.0`** — binds all interfaces, so "Caddy is the only way
  in" rests on the firewall alone.
