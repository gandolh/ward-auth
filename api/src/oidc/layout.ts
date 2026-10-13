/**
 * Where the provider lives, seen from both sides of the proxy.
 *
 * Caddy serves Ward with `handle_path /ward-api/*`, which strips the prefix, so
 * a browser's `https://example.com/ward-api/oidc/auth` arrives here as
 * `/oidc/auth`. `oidc-provider` builds every URL it advertises from the request
 * it is handling, so left alone it would publish `/oidc/auth` — a URL nobody
 * outside can reach. That is the bug class integrating.md rule 2 records, and
 * this module is the one place that knows both halves:
 *
 *  - the **issuer**, from `WARD_OIDC_ISSUER`, is the truth about the outside;
 *  - **`/oidc`** is the internal mount, fixed here, and the issuer must end
 *    in it (config.ts refuses one that does not);
 *  - so whatever precedes `/oidc` in the issuer's path is the stripped prefix.
 *
 * Nothing here reads a request header. The external URL is configuration, so a
 * request cannot talk the provider into advertising somebody else's host.
 */

/** Where Fastify mounts the provider. Every provider route is under it. */
export const OIDC_INTERNAL_PREFIX = "/oidc";

/**
 * Where Fastify mounts the interaction step (`oidc/interaction.ts`).
 *
 * Under `/refresh` on purpose: Ward's refresh cookie is scoped to
 * `Path=/ward-api/refresh` and the interaction has to read it, so the route
 * lives where the cookie already goes instead of widening the cookie. The same
 * move `POST /refresh/logout` made.
 */
export const INTERACTION_INTERNAL_PREFIX = "/refresh/oidc";

export interface OidcLayout {
  /** `WARD_OIDC_ISSUER`, verbatim. The `iss` of every ID token. */
  readonly issuer: string;
  /** The issuer's origin, `scheme://host[:port]`. */
  readonly origin: string;
  /** `host[:port]`, what the provider is told its host is. */
  readonly host: string;
  /** `https` or `http`, what the provider is told its protocol is. */
  readonly protocol: "https" | "http";
  /** What the proxy strips: `/ward-api` behind Caddy, `""` when direct. */
  readonly strippedPrefix: string;
  /** The issuer's path: `strippedPrefix` + `/oidc`. */
  readonly issuerPath: string;
  /** Ward's login page, absolute (`WARD_UI_URL` + `/login`). */
  readonly loginUrl: string;
}

export function oidcLayout(issuer: string, uiUrl: string): OidcLayout {
  const url = new URL(issuer);
  const issuerPath = url.pathname.replace(/\/+$/, "");
  if (!issuerPath.endsWith(OIDC_INTERNAL_PREFIX)) {
    // config.ts already refuses this; restated so the module is safe on its own.
    throw new Error(`WARD_OIDC_ISSUER must end in ${OIDC_INTERNAL_PREFIX}: ${issuer}`);
  }
  return Object.freeze({
    issuer,
    origin: url.origin,
    host: url.host,
    protocol: url.protocol === "https:" ? "https" : "http",
    strippedPrefix: issuerPath.slice(0, -OIDC_INTERNAL_PREFIX.length),
    issuerPath,
    loginUrl: `${uiUrl.replace(/\/+$/, "")}/login`,
  });
}

/** The interaction URL the provider redirects a browser to, absolute and external. */
export function interactionUrl(layout: OidcLayout, uid: string): string {
  return `${layout.origin}${layout.strippedPrefix}${INTERACTION_INTERNAL_PREFIX}/${encodeURIComponent(uid)}`;
}

/** Ward's login page for one interaction: `<ui>/login?oidc=<uid>`. */
export function loginUrlFor(layout: OidcLayout, uid: string): string {
  return `${layout.loginUrl}?oidc=${encodeURIComponent(uid)}`;
}
