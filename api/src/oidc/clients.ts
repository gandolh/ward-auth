import { isIP } from "node:net";

import { calculateJwkThumbprint } from "jose";

import { oidcClientOf, type AppRow, type OidcClientRegistration } from "../db/apps.js";

/**
 * Apps as OpenID Connect clients.
 *
 * `client_id` is the app's slug. An app is a client once it has at least one
 * redirect URI **and** a public key; until then the provider answers
 * `invalid_client` for it, which is the right answer for an app that has not
 * been set up.
 *
 * ## How a client authenticates: `private_key_jwt`, and nothing else
 *
 * Settled 2026-10-13 in decisions-oidc.md. The app holds an Ed25519 private key
 * in its own environment and signs a short client assertion with it; Ward holds
 * only the public JWK. Ward therefore stores no app secret at all — the same
 * property the app keys bought by storing a sha256 (decisions-app-keys.md), but
 * without a shared value to hash. `client_secret_basic` would need the
 * plaintext secret on Ward's side, which is what the app-key design refused.
 *
 * Everything the provider could negotiate is pinned instead: one grant type,
 * one response type, one auth method, one algorithm. A client row cannot ask
 * for anything else, because none of this is stored per app.
 */

/** The ID token signature algorithm: EdDSA over Ward's Ed25519 key. */
export const CLIENT_ALG = "EdDSA";

/**
 * The `alg` values a client assertion may carry. Both name the same thing — an
 * Ed25519 signature — and the ecosystem is mid-rename: RFC 8037's `EdDSA` is
 * what jose and most libraries emit, while `openid-client` 6 (through
 * oauth4webapi) signs with the fully-specified `Ed25519`. Accepting only one
 * would make every token request from the other `invalid_client`. Stored
 * client keys therefore carry no `alg` of their own, which would otherwise pin
 * them to one name.
 */
export const CLIENT_ASSERTION_ALGS: ("EdDSA" | "Ed25519")[] = ["EdDSA", "Ed25519"];

/** Bounds for the console. Generous for dev + production + a spare. */
export const MAX_URIS = 10;
export const MAX_URI_LENGTH = 512;
export const MAX_CLIENT_KEYS = 4;

/**
 * The metadata `oidc-provider` sees for an app, or `undefined` when the app
 * is not (yet) a client.
 */
export function clientMetadataFor(row: AppRow): Record<string, unknown> | undefined {
  const client = oidcClientOf(row);
  if (client.redirectUris.length === 0 || client.jwks === null || client.jwks.keys.length === 0) {
    return undefined;
  }
  return {
    client_id: row.slug,
    client_name: row.name,
    application_type: "web",
    redirect_uris: client.redirectUris,
    post_logout_redirect_uris: client.postLogoutRedirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt",
    id_token_signed_response_alg: CLIENT_ALG,
    jwks: client.jwks,
  };
}

export type ClientRegistrationError =
  | "invalid_redirect_uri"
  | "invalid_post_logout_redirect_uri"
  | "invalid_client_key"
  | "private_key_not_public";

/**
 * Validate one list of redirect URIs from the console.
 *
 * Absolute `https:` URLs, or `http:` on a loopback host for a dev server, with
 * no fragment. The provider compares a presented `redirect_uri` against this
 * list as an exact string, so normalising here would only hide a mismatch the
 * app would hit later; a value is refused rather than rewritten.
 */
export function validRedirectUris(value: readonly string[]): boolean {
  if (value.length > MAX_URIS) return false;
  return value.every((uri) => {
    if (uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return false;
    }
    if (url.hash !== "" || uri.includes("#")) return false;
    if (url.username !== "" || url.password !== "") return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopback(url.hostname);
  });
}

/**
 * `localhost`, `[::1]`, or an IPv4 literal in 127.0.0.0/8. `URL` has already
 * lower-cased the host and normalised IPv4 forms (`127.1`, `0x7f.0.0.1`) to
 * dotted quads; a name that merely starts with `127.` (`127.evil.example`) is
 * a public host and refused.
 */
function isLoopback(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return isIP(hostname) === 4 && hostname.split(".")[0] === "127";
}

/**
 * Turn what the operator pasted — one public JWK, or a JWK Set — into the key
 * set Ward stores, or say why not.
 *
 * Each key must be a **public** Ed25519 key. A key carrying `d` is a private
 * key pasted by mistake, and is refused with its own error rather than quietly
 * stripped: whoever pasted it has just put the app's credential somewhere it
 * should not be, and needs to be told so they can make a new one.
 *
 * Stored keys are rebuilt from an allowlist of members (`kty`, `crv`, `x`,
 * `kid`, `use`), the same discipline `tokens/keys.ts` applies to Ward's own
 * published key. An `alg` on the way in must name Ed25519 but is not kept (see
 * `CLIENT_ASSERTION_ALGS`). A missing `kid` becomes the key's RFC 7638 thumbprint, so
 * the app's assertion header and Ward's stored key can always be matched.
 */
export async function parseClientJwks(
  input: unknown,
): Promise<{ keys: Record<string, unknown>[] } | ClientRegistrationError> {
  const candidates: unknown[] =
    typeof input === "object" && input !== null && Array.isArray((input as { keys?: unknown }).keys)
      ? (input as { keys: unknown[] }).keys
      : [input];

  if (candidates.length === 0 || candidates.length > MAX_CLIENT_KEYS) return "invalid_client_key";

  const keys: Record<string, unknown>[] = [];
  const kids = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return "invalid_client_key";
    }
    const jwk = candidate as Record<string, unknown>;
    if ("d" in jwk) return "private_key_not_public";
    if (jwk["kty"] !== "OKP" || jwk["crv"] !== "Ed25519") return "invalid_client_key";
    const x = jwk["x"];
    // An Ed25519 public key is 32 bytes: 43 base64url characters, unpadded.
    if (typeof x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(x)) return "invalid_client_key";
    if (
      jwk["alg"] !== undefined &&
      !(CLIENT_ASSERTION_ALGS as string[]).includes(String(jwk["alg"]))
    ) {
      return "invalid_client_key";
    }
    if (jwk["use"] !== undefined && jwk["use"] !== "sig") return "invalid_client_key";

    let kid = jwk["kid"];
    if (kid === undefined) {
      kid = await calculateJwkThumbprint({ kty: "OKP", crv: "Ed25519", x });
    }
    if (typeof kid !== "string" || kid.length === 0 || kid.length > 128 || kids.has(kid)) {
      return "invalid_client_key";
    }
    kids.add(kid);
    keys.push({ kty: "OKP", crv: "Ed25519", x, kid, use: "sig" });
  }
  return { keys };
}

/** Validate and assemble a whole registration from the console's request body. */
export async function parseClientRegistration(body: {
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  jwks: unknown;
}): Promise<OidcClientRegistration | ClientRegistrationError> {
  if (!validRedirectUris(body.redirectUris)) return "invalid_redirect_uri";
  if (!validRedirectUris(body.postLogoutRedirectUris)) return "invalid_post_logout_redirect_uri";

  let jwks: OidcClientRegistration["jwks"] = null;
  if (body.jwks !== null && body.jwks !== undefined) {
    const parsed = await parseClientJwks(body.jwks);
    if (typeof parsed === "string") return parsed;
    jwks = parsed;
  }

  return {
    redirectUris: [...new Set(body.redirectUris)],
    postLogoutRedirectUris: [...new Set(body.postLogoutRedirectUris)],
    jwks,
  };
}
