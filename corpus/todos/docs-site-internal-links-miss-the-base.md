# Docs site: internal links in .mdx pages miss the deploy base

**Promoted 2026-10-18** into [brief 31](../briefs/todo/31-docs-site-on-docusaurus.md):
moving the site to Docusaurus fixes both halves. Delete this todo when 31 lands.

Captured 2026-10-13 during brief 30's docs pass; it predates that brief.

Links written in the authored `.mdx` pages as root-absolute paths (for example `/oidc/`) build to
`href="/oidc/"` without the site's `/ward/docs/` base, so on the deployed site
they 404. The sidebar links are fine because Starlight prefixes them. Fix by
writing the links relative, or by a remark/rehype step that applies `base`.
While there: `decisions-oidc.md` is not in `docs/scripts/sync-corpus.mjs`'s
page list, so the OIDC page can only name it as plain text.
