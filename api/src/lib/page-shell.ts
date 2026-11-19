/**
 * The shell of the pages the API renders itself (the OIDC flow's error and expired pages, the email confirmation
 * page). They sit between the sign-in pages, which follow the Light / Dark / System choice kept on the device, so
 * they read the same choice. The API and the sign-in pages share an origin, so the `theme` key in `localStorage` is
 * the same one.
 *
 * No external fonts or styles: a request for either would tell a third party every time someone hits one of these
 * pages.
 */

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * The saved theme before the first paint, so a dark choice never flashes light. Light on a first visit, even when
 * the system is dark. It touches no cookie and makes no request. It is the script in the sign-in app's `index.html`.
 * Ward sends no `script-src` today; if one is added, this script and that one need a hash or a move to a file.
 */
const BOOT_SCRIPT = `(function () {
  var theme = "light";
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "system") theme = saved;
  } catch (error) {
    // Storage is blocked: light.
  }
  var dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="color-scheme"]').setAttribute("content", dark ? "dark" : "light");
})();`;

/**
 * The sign-in pages' colours, copied from the `--ward-*` tokens in the sign-in app's `styles/index.css`: the limestone
 * ground and the lichen accent, then the same turned over under `data-theme="dark"`.
 */
const STYLE = `:root{color-scheme:light;--ward-bg:#e9e8e1;--ward-surface:#fff;--ward-border:#cac8bd;--ward-text:#191b19;--ward-text-muted:#4a4f49;--ward-accent:#2f4a3a;--ward-accent-hover:#223829}
:root[data-theme="dark"]{color-scheme:dark;--ward-bg:#121412;--ward-surface:#202520;--ward-border:#363c36;--ward-text:#e9ebe7;--ward-text-muted:#b5b9b2;--ward-accent:#a3c2ab;--ward-accent-hover:#b9d4c0}
body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:var(--ward-text);background:var(--ward-bg)}
h1{font-size:1.4rem;font-weight:600}
a{color:var(--ward-accent)}
a:hover{color:var(--ward-accent-hover)}
code{font-size:.9em}`;

export interface PageShellOptions {
  /** The text of the `<title>` element and the heading; escaped here. */
  title: string;
  /** The `<title>` when it differs from the heading; escaped here. */
  documentTitle?: string;
  /** HTML placed under the heading; the caller escapes anything it interpolates. */
  body: string;
  /** Extra `<meta>` tags for the head, as HTML. */
  headExtra?: string;
}

export function pageShell({ title, documentTitle, body, headExtra = "" }: PageShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  ${headExtra}<script>${BOOT_SCRIPT}</script>
  <title>${escapeHtml(documentTitle ?? title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>
`;
}
