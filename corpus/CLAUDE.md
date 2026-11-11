# wzd_auth corpus

Start at [index.md](index.md); [routing.md](routing.md) says which layer answers
what. The commands, the hard rules and the brief-board section are in the
repo's root [CLAUDE.md](../CLAUDE.md).

## Conventions

- Brief numbers are stable for the life of the file; briefs run in number
  order, and `wiki/status.md` doesn't list them.
- Numbering restarted at 01 on 2026-11-02. The forty-three briefs before that
  were folded into the wiki and deleted; the last commit holding them is
  `5de7c6b` ([log.md](log.md), "Briefs reset").
- Code comments, test titles and docs don't cite brief numbers ("brief 28",
  "(Ward's brief 41)"), Ward's or another repo's. Say what the code does and
  why, or give the date; the history belongs in `log.md`. The dated migration
  files under `api/src/db/migrations/` and the SQL in
  `shared-library/src/store/migrations.ts` keep theirs.
