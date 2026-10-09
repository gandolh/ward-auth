# Ward docs

Start with the [main README](../README.md). This folder is the source of the docs site at
<https://gandolh.ro/ward/docs/>, plus the images the main README uses. The site build ignores this
file and `images/`.

| Path | What it is |
| --- | --- |
| [src/content/docs/](src/content/docs/) | The site's hand-written pages, listed below |
| [diagrams/](diagrams/) | archify JSON sources for the site's three diagrams, compiled into `public/diagrams/` |
| [scripts/](scripts/) | `sync-corpus.mjs` copies the corpus wiki into the site; `build-diagrams.mjs` compiles the diagrams |
| [images/](images/shots.md) | Screenshots used in the main README, and how each was made |

The rest (`astro.config.mjs`, `src/components/`, `src/styles/`, `public/`, `typedoc.json`) is the
Starlight site's own setup and build output.

## Pages on the site

| Page | Live | Source |
| --- | --- | --- |
| What Ward is | [/ward/docs/](https://gandolh.ro/ward/docs/) | [index.mdx](src/content/docs/index.mdx) |
| Architecture | [/architecture/](https://gandolh.ro/ward/docs/architecture/) | [architecture.mdx](src/content/docs/architecture.mdx) |
| The one-origin estate | [/topology/](https://gandolh.ro/ward/docs/topology/) | [topology.mdx](src/content/docs/topology.mdx) |
| Sessions and tokens | [/sessions/](https://gandolh.ro/ward/docs/sessions/) | [sessions.mdx](src/content/docs/sessions.mdx) |
| Introspection and revocation | [/introspection/](https://gandolh.ro/ward/docs/introspection/) | [introspection.mdx](src/content/docs/introspection.mdx) |
| Grants | [/grants/](https://gandolh.ro/ward/docs/grants/) | [grants.mdx](src/content/docs/grants.mdx) |
| App keys | [/app-keys/](https://gandolh.ro/ward/docs/app-keys/) | [app-keys.mdx](src/content/docs/app-keys.mdx) |
| HTTP API | [/api/](https://gandolh.ro/ward/docs/api/) | [api.mdx](src/content/docs/api.mdx) |
| Data model | [/data/](https://gandolh.ro/ward/docs/data/) | [data.mdx](src/content/docs/data.mdx) |
| Configuration | [/configuration/](https://gandolh.ro/ward/docs/configuration/) | [configuration.mdx](src/content/docs/configuration.mdx) |

The site's "Deep dive" and "Status" sections are copies of `corpus/wiki/` and `corpus/log.md`,
made on every build into `src/content/docs/wiki/` (gitignored). Edit the corpus, not the copies. The
[`@ward/client` reference](https://gandolh.ro/ward/docs/reference/client/) is TypeDoc output from
`client/`, also generated and gitignored.

`npm run docs` in this folder runs the whole build into `dist/`, and `npm run dev` serves a local
preview. The diagram step regenerates `public/diagrams/` only where the archify skill is installed;
elsewhere it checks that the committed HTML is complete.

Running Ward itself on your machine: [infrastructure/local/README.md](../infrastructure/local/README.md).

## Going deeper

The project wiki starts at [corpus/index.md](../corpus/index.md). The pages a newcomer usually
wants:

- [overview.md](../corpus/wiki/overview.md): what Ward is and the shape it settled on
- [status.md](../corpus/wiki/status.md): dated snapshot of what is built and deployed
- [estate.md](../corpus/wiki/estate.md): the separate auth stacks the apps had before Ward, and the
  one-origin layout that ruled out several designs
- [landscape.md](../corpus/wiki/landscape.md): the options considered, from forward-auth gateways
  and OIDC providers to an owned service
- [integrating.md](../corpus/wiki/integrating.md): the contract every app's Ward client follows

`bash corpus/lint.sh` must exit clean before you commit corpus changes.
