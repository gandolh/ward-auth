# Brief 31 — Move the docs site from Starlight to Docusaurus

## Context

On 2026-10-18 the owner decided to move every project's docs site from Astro
Starlight to Docusaurus. `docs/` (`@ward/docs-site`, served at `/ward/docs/`) is
one of them.

The recipe is written and verified. The `corpus-docs-site` skill
(personal-skills v0.31.0, source in
`~/projects/my-personal-skills/skills/corpus-docs-site/`) now scaffolds
Docusaurus 3.10, and `references/migrating-from-starlight.md` beside it holds
the file, config and content maps plus ten gotchas, each hit during a real
port. **Read that guide first.** The files this brief tells you to copy are in
the same folder. If the installed plugin is older than v0.31.0, read them from
the source path.

What the site has today (2026-10-18):
- base `/ward/docs/` (`DOCS_BASE ??`), light only (Ward's limestone surface,
  both `Theme*.astro` overrides), 23 sidebar links;
- nine authored pages: `index`, `architecture`, `topology`, `sessions` (two
  `Diagram`s), `grants`, `api`, `data`, `configuration` and `oidc`, with
  20 `:::note`, two `:::caution` and three `:::danger`;
- `src/styles/theme.css` (244 lines, 41 `--sl-*` tokens; Ward's own tokens
  verbatim, no extra font packages);
- `scripts/sync-corpus.mjs` with a hand-kept list of 14 pages, and
  `scripts/build-diagrams.mjs` (three archify diagrams);
- no TypeDoc.

**This brief closes the todo `corpus/todos/docs-site-internal-links-miss-the-base.md`,
both halves of it.**
- Docusaurus adds `baseUrl` to root-absolute links in MDX (`/oidc/`,
  `/api/#public--no-credential`, `/data/#backups`). Starlight did not, so
  those links 404 on the live site today. Verified on a prototype on
  2026-10-18: a Markdown link to the root-absolute path `/wiki/overview/`
  built to `href=/<base>/wiki/overview/`.
- The new sync discovers every `corpus/wiki/*.md` instead of reading a list,
  so `decisions-oidc.md` renders and the OIDC page can link it.

**Built through Docusaurus on 2026-10-18.** All 16 corpus pages built through
the new sync in `markdown.format: 'detect'` mode, with no broken links or
anchors. In MDX mode the corpus does not compile.

## Files you OWN

- `docs/` (the site files: config, `scripts/`, `src/`, `public/`→`static/`,
  `package.json`, `tsconfig.json`, `.gitignore`, `README.md`). `docs/images/`
  and `docs/cutover-oidc.md` stay as they are.
- `package-lock.json`
- Framework mentions in `README.md` (line 95), `corpus/wiki/overview.md`
  (line 50) and `corpus/wiki/status.md` (line 137)
- `corpus/todos/docs-site-internal-links-miss-the-base.md` (deleting it when
  this lands)

## What to do

1. **Baseline.** `npm run docs -w @ward/docs-site`, then save
   `(cd docs/dist && find . -name index.html | sort) > /tmp/ward-routes-before.txt`.
2. **Config.** Write `docs/docusaurus.config.ts` from the skill's reference.
   Set baseUrl `process.env.DOCS_BASE ?? '/ward/docs/'`, `trailingSlash: true`,
   `routeBasePath: '/'`, `markdown.format: 'detect'`, light-only `colorMode`,
   local search, and the GitHub navbar item. Port the 23-link sidebar to
   `docs/sidebars.ts`, and add `wiki/decisions-oidc` and
   `wiki/decisions-oidc-build` next to the other decisions pages. The old
   14-page list had neither; discovery publishes both. Content lives in `docs/docs/`.
3. **package.json** per the guide: no `"type": "module"`, keep the
   `browserslist`, and add `start`/`docs`/`typecheck`. Drop `astro`,
   `@astrojs/starlight` and `sharp`; grep the repo first for any other importer
   of `sharp`.
4. **Content.** Move the nine `.mdx` pages to `docs/docs/`. `index.mdx` gets
   `slug: /`. Replace the `tableOfContents` key. Keep the root-absolute links
   as written, because they now work. Use the skill's `Diagram.tsx`.
   `git mv public/diagrams static/diagrams`, and point `build-diagrams.mjs` at
   it. Where the OIDC page names `decisions-oidc.md` as plain text, make it a
   link (`/wiki/decisions-oidc/`).
5. **Sync.** Use the skill's `sync-corpus.mjs` with `GITHUB_REPO` set to this
   repo's GitHub URL (`github.com/gandolh/ward-auth`). The corpus has no
   cross-repo links.
6. **Theme.** Port `theme.css` to `src/css/custom.css` with the guide's token
   and selector maps (the skill's `references/custom.css` header). Ward's
   tokens stay verbatim.
7. **Wiring.** `docs/.gitignore`: `.astro/` → `.docusaurus/`,
   `src/content/docs/wiki/` → `docs/wiki/`. Update `docs/README.md` (lines
   15–16, "the Starlight site's own setup") and the three framework mentions
   listed under Files you OWN. When everything passes, delete the todo and
   say so in the `log.md` entry.

## Acceptance

- `npm run docs -w @ward/docs-site` exits 0 with `onBrokenLinks: 'throw'`.
- Route parity: the new route list equals `/tmp/ward-routes-before.txt` plus
  `./search/index.html`, `./wiki/decisions-oidc/index.html` and
  `./wiki/decisions-oidc-build/index.html`.
- No root-absolute link in `docs/dist` misses the base:
  `grep -rhoE 'href=[^ >]+' docs/dist --include=index.html | grep -vE 'href=("?)(https?:|#|/ward/docs/|mailto:)' | sort -u`
  prints nothing that is a site page.
- `grep -c '/ward/docs/assets/' docs/dist/index.html` is non-zero, and
  `grep -rl '_astro' docs/dist` finds nothing.
- `npm run typecheck -w @ward/docs-site` and the repo's own checks pass.
- Browser check, with `docs/dist` served at `/ward/docs/` by a plain static
  server (not `docusaurus serve`):
  - from `/configuration/`, the links to `/api/`, `/data/` and `/oidc/` land
    on those pages, not on a 404;
  - the three diagrams load;
  - there is no theme toggle;
  - search returns results.
  Screenshot the landing page and `/sessions/`.
- `bash corpus/lint.sh` passes.

## Out of scope

Deploying. The owner deploys after vps-deploy brief 11 flips the `ward` docs
stack.
