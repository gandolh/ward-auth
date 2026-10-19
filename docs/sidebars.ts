import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

// Doc items are checked at build time: a sidebar entry for a page that does not
// exist fails the build instead of rendering a dead link. Doc ids are paths
// under docs/ without the extension (docs/wiki/status.md → 'wiki/status').
//
// The corpus pages are listed by hand because the sidebar is curated (labels,
// grouping). scripts/sync-corpus.mjs publishes every corpus/wiki/*.md, so a new
// wiki page builds even before it is listed here; add it to the right group.
const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Start here',
      collapsible: false,
      items: [
        { type: 'doc', id: 'index', label: 'What Ward is' },
        { type: 'doc', id: 'architecture', label: 'Architecture' },
        { type: 'doc', id: 'topology', label: 'The one-origin estate' },
      ],
    },
    {
      type: 'category',
      label: 'How it works',
      collapsible: false,
      items: [
        { type: 'doc', id: 'sessions', label: 'Sessions and tokens' },
        { type: 'doc', id: 'grants', label: 'Grants — the security boundary' },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsible: false,
      items: [
        { type: 'doc', id: 'api', label: 'HTTP API' },
        { type: 'doc', id: 'data', label: 'Data model' },
        { type: 'doc', id: 'configuration', label: 'Configuration' },
      ],
    },
    {
      type: 'category',
      label: 'Integrate an app',
      collapsible: false,
      items: [
        { type: 'doc', id: 'oidc', label: 'Sign in with Ward (OIDC)' },
        { type: 'doc', id: 'wiki/integrating', label: 'Integrating an app' },
      ],
    },
    {
      type: 'category',
      label: 'Deep dive — from the corpus',
      collapsible: false,
      items: [
        { type: 'doc', id: 'wiki/overview', label: 'Overview' },
        { type: 'doc', id: 'wiki/estate', label: 'The estate as it stands' },
        { type: 'doc', id: 'wiki/glossary', label: 'Glossary' },
        { type: 'doc', id: 'wiki/decisions', label: 'Decisions — foundations' },
        { type: 'doc', id: 'wiki/decisions-accounts', label: 'Decisions — accounts' },
        { type: 'doc', id: 'wiki/decisions-tokens', label: 'Decisions — tokens' },
        { type: 'doc', id: 'wiki/decisions-admin', label: 'Decisions — admin' },
        { type: 'doc', id: 'wiki/decisions-app-keys', label: 'Decisions — app keys (retired)' },
        { type: 'doc', id: 'wiki/decisions-implementation', label: 'Decisions — implementation' },
        { type: 'doc', id: 'wiki/decisions-oidc', label: 'Decisions — OIDC redesign' },
        { type: 'doc', id: 'wiki/decisions-oidc-build', label: 'Decisions — OIDC build' },
        { type: 'doc', id: 'wiki/landscape', label: 'Landscape — roads not taken' },
        { type: 'doc', id: 'wiki/open-questions', label: 'Open questions' },
      ],
    },
    {
      type: 'category',
      label: 'Status',
      collapsible: false,
      items: [
        { type: 'doc', id: 'wiki/status', label: 'Status snapshot' },
        { type: 'doc', id: 'wiki/log', label: 'Change log' },
      ],
    },
  ],
}

export default sidebars
