import type Database from "better-sqlite3";
import { createLocalJWKSet, decodeJwt, errors as joseErrors, jwtVerify, type JWK } from "jose";

import { getApp } from "../db/apps.js";
import { claimReplayMarker, epochNow } from "./adapter.js";
import { CLIENT_ASSERTION_ALGS, clientMetadataFor } from "./clients.js";

/**
 * Verify an app's `private_key_jwt` client assertion **outside** the provider.
 *
 * The token endpoint does this itself, inside `oidc-provider`. Ward's own
 * endpoints that an app calls server-to-server — brief 19's
 * `POST /session-status` and `POST /notify` — need the
 * same check without a Koa context, and this is it. It reads the same keys
 * (the `apps` row) and spends the same replay markers as the provider, so one
 * assertion is good for exactly one call anywhere at Ward.
 *
 * What an app sends: a compact JWS signed with its Ed25519 private key (`alg`
 * `EdDSA` or `Ed25519`, see `CLIENT_ASSERTION_ALGS`), header `kid` naming the key, and claims `iss` = `sub` = its `client_id`,
 * `aud` = the audience the endpoint names (the issuer, unless the endpoint says
 * otherwise), `exp` a short time ahead, and a fresh `jti`. That is exactly the
 * assertion `openid-client`'s `PrivateKeyJwt` builds.
 *
 * Every refusal comes back as a reason, never a throw, so a caller maps all of
 * them to one `401` and logs the reason; telling the caller which check failed
 * would only help someone probing.
 */

export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** The provider's own clock tolerance (its default), so both checks agree. */
export const CLIENT_ASSERTION_CLOCK_TOLERANCE_SECONDS = 15;

export type ClientAuthRejection =
  "absent" | "malformed" | "unknown_client" | "invalid_signature" | "invalid_claims" | "replayed";

export type ClientAuthResult =
  | { readonly ok: true; readonly clientId: string }
  | { readonly ok: false; readonly reason: ClientAuthRejection };

export interface VerifyClientAssertionOptions {
  /**
   * What `aud` must contain. Pass the issuer (what `openid-client` puts there),
   * and the endpoint's own external URL if apps may use that instead.
   */
  audience: string | string[];
}

export async function verifyClientAssertion(
  db: Database.Database,
  assertion: string | undefined,
  options: VerifyClientAssertionOptions,
): Promise<ClientAuthResult> {
  if (assertion === undefined || assertion.length === 0) return { ok: false, reason: "absent" };
  if (assertion.length > 8192) return { ok: false, reason: "malformed" };

  // Unverified read of `iss`, only to choose whose keys to verify with. Nothing
  // read here is trusted until `jwtVerify` below has checked the signature.
  let clientId: unknown;
  try {
    clientId = decodeJwt(assertion).iss;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof clientId !== "string" || clientId.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const row = getApp(db, clientId);
  const metadata = row === undefined ? undefined : clientMetadataFor(row);
  if (metadata === undefined) return { ok: false, reason: "unknown_client" };
  const keys = createLocalJWKSet(metadata["jwks"] as { keys: JWK[] });

  let payload: { jti?: unknown; exp?: unknown };
  try {
    ({ payload } = await jwtVerify(assertion, keys, {
      algorithms: CLIENT_ASSERTION_ALGS,
      issuer: clientId,
      subject: clientId,
      audience: options.audience,
      requiredClaims: ["exp", "jti"],
      clockTolerance: CLIENT_ASSERTION_CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (error) {
    if (
      error instanceof joseErrors.JWTClaimValidationFailed ||
      error instanceof joseErrors.JWTExpired
    ) {
      return { ok: false, reason: "invalid_claims" };
    }
    return { ok: false, reason: "invalid_signature" };
  }

  if (
    typeof payload.jti !== "string" ||
    payload.jti.length === 0 ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "invalid_claims" };
  }

  const fresh = claimReplayMarker(
    db,
    clientId,
    payload.jti,
    payload.exp + CLIENT_ASSERTION_CLOCK_TOLERANCE_SECONDS,
    epochNow(),
  );
  if (!fresh) return { ok: false, reason: "replayed" };

  return { ok: true, clientId };
}
