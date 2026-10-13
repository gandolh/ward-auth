import { randomUUID, webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;

/**
 * The app's client credential at Ward: an Ed25519 private key.
 *
 * Ward authenticates apps with `private_key_jwt` (decisions-oidc-build.md,
 * "Apps authenticate as clients"). The app holds the private half in
 * `WARD_OIDC_CLIENT_KEY` — base64url of the JSON private JWK
 * `{ kty: "OKP", crv: "Ed25519", x, d, kid, use: "sig" }`, exactly what Ward's
 * `npm run oidc-client-key` and the local seed write — and Ward holds only the
 * public half. There is no shared secret anywhere.
 *
 * The same key signs three kinds of request:
 *
 * - the token request of the code exchange, through `openid-client`'s
 *   `PrivateKeyJwt` (which names the algorithm `Ed25519`);
 * - `POST /session-status`, the 30-second check;
 * - `POST /notify`.
 *
 * For the last two this file builds the assertion itself, because they are
 * Ward's own endpoints and not OAuth ones `openid-client` knows. The claims
 * are what Ward's `client-auth.ts` checks: `iss` = `sub` = the client id,
 * `aud` = the issuer, a short `exp`, and a fresh `jti` for every call (Ward
 * spends each `jti` once, sharing the markers with its token endpoint).
 */

/** The `client_assertion_type` for `private_key_jwt`. */
export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** How long a hand-built assertion is good for. Ward allows 15 s of clock skew. */
const ASSERTION_LIFETIME_SECONDS = 60;

/** A parsed client key, ready to sign with. */
export interface ClientKey {
  /** The JWK `kid`, sent in every assertion's header so Ward picks the right key. */
  kid: string;
  /** Non-extractable WebCrypto key: what `openid-client` takes, and what signs here. */
  privateKey: CryptoKey;
}

/** Thrown at boot for a `WARD_OIDC_CLIENT_KEY` that is not an Ed25519 private JWK. */
export class InvalidClientKeyError extends Error {
  constructor(detail: string) {
    // Never echo the value: it is the app's private key.
    super(`WARD_OIDC_CLIENT_KEY is not usable: ${detail}`);
    this.name = "InvalidClientKeyError";
  }
}

/**
 * Parse `WARD_OIDC_CLIENT_KEY` and import the private key.
 *
 * Only the members WebCrypto needs are handed to it (`kty`, `crv`, `x`, `d`):
 * `use` and `kid` are ours, and a stray `alg` or `key_ops` would make the
 * import fail for a reason that has nothing to do with the key.
 */
export async function importClientKey(encoded: string): Promise<ClientKey> {
  let jwk: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded.trim(), "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    jwk = parsed as Record<string, unknown>;
  } catch {
    throw new InvalidClientKeyError("expected base64url of a JSON JWK");
  }

  const { kty, crv, x, d, kid } = jwk;
  if (kty !== "OKP" || crv !== "Ed25519") {
    throw new InvalidClientKeyError('expected an Ed25519 key (kty "OKP", crv "Ed25519")');
  }
  if (typeof x !== "string" || typeof d !== "string") {
    throw new InvalidClientKeyError(
      "expected the private key (x and d); this looks like the public half",
    );
  }
  if (typeof kid !== "string" || kid.length === 0) {
    throw new InvalidClientKeyError("expected a kid, which Ward uses to pick the key");
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await webcrypto.subtle.importKey(
      "jwk",
      { kty, crv, x, d },
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } catch {
    throw new InvalidClientKeyError("the key material does not import as Ed25519");
  }
  return { kid, privateKey };
}

/**
 * A compact JWS client assertion for one call to one of Ward's own endpoints.
 * `nowSeconds` is the real clock: Ward checks `exp` against its own.
 */
export async function signClientAssertion(
  key: ClientKey,
  clientId: string,
  audience: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { alg: "EdDSA", kid: key.kid };
  const claims = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
    jti: randomUUID(),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}
