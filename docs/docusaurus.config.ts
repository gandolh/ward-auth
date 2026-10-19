import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

/**
 * Ward's documentation site.
 *
 *   • Narrative  → authored here (the pages under docs/*.mdx).
 *   • Corpus     → synced by scripts/sync-corpus.mjs into docs/wiki/.
 *                  Never edit those by hand; edit corpus/ and rebuild.
 *   • Diagrams   → compiled by scripts/build-diagrams.mjs (archify) from the
 *                  typed JSON IR in diagrams/, into static/diagrams/.
 *
 * The base path is a sub-path deploy on the estate's single origin. See
 * vps-deploy/docs/docs-route-convention.md.
 */
// The deployed base path, baked in rather than injected at deploy time.
//
// vps-deploy ships what this repo already built and VERIFIES this base — it does
// not set it. That is the estate's rule for the case that matters most (Ward's
// UI does the same, see vps-deploy/stacks/ward.ts): a variable the deploy passes
// that changes nothing is a variable that can silently disagree, whereas a value
// baked here and checked there cannot. Build with `npm run docs`; a wrong base
// fails the deploy by name instead of shipping a page whose every asset 404s.
//
// DOCS_BASE still overrides it, for building a copy to serve from somewhere else.
const baseUrl = process.env.DOCS_BASE ?? '/ward/docs/'

const config: Config = {
  title: 'Ward',
  tagline: 'One identity, one credential store, one set of access grants.',
  // The estate's one canonical origin, for the absolute URLs in the sitemap;
  // `baseUrl` above supplies the path half.
  url: 'https://gandolh.ro',
  baseUrl,
  // Directory-style URLs (/wiki/overview/ → wiki/overview/index.html), the same
  // layout the Starlight site published.
  trailingSlash: true,
  future: { v4: true },
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',
  markdown: {
    // .md (the synced corpus) parses as CommonMark, .mdx (the authored pages) as
    // MDX. MDX for everything breaks on corpus prose: a bare `<` or `{` is JSX.
    format: 'detect',
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/', // docs-only site: no /docs/ prefix under the base
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  // Local, offline search (Starlight shipped Pagefind; Docusaurus ships nothing).
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      { hashed: true, docsRouteBasePath: '/', indexBlog: false, indexPages: false },
    ],
  ],
  themeConfig: {
    // Light only. Ward's own UI is a light "limestone" surface with a single
    // accent, and the docs take the same ground — see src/css/custom.css for why
    // the console's dark palette is quoted rather than adopted. With
    // disableSwitch the inline script hard-codes the mode: no toggle, and a
    // stored preference is never read.
    colorMode: { defaultMode: 'light', disableSwitch: true, respectPrefersColorScheme: false },
    navbar: {
      title: 'Ward',
      items: [{ href: 'https://github.com/gandolh/ward-auth', label: 'GitHub', position: 'right' }],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
