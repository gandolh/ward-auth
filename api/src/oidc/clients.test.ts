import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SignJWT, importJWK, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, setOidcClient } from "../db/apps.js";
import { freshDb } from "../db/test-support.js";
import { verifyClientAssertion } from "./client-auth.js";
import { decodeClientKey, generateClientKeyPair } from "./client-keygen.js";
import { parseClientJwks, parseClientRegistration, validRedirectUris } from "./clients.js";
import { interactionUrl, loginUrlFor, oidcLayout } from "./layout.js";
import { rewriteForProvider } from "./routes.js";

const ISSUER = "https://example.com/ward-api/oidc";

describe("client registration", () => {
  it("accepts https redirect URIs, and http only on loopback", () => {
    expect(validRedirectUris(["https://example.com/atrium/auth/ward/callback"])).toBe(true);
    expect(validRedirectUris(["http://localhost:5173/atrium/auth/ward/callback"])).toBe(true);
    expect(validRedirectUris(["http://127.0.0.1:4321/cb"])).toBe(true);
    expect(validRedirectUris(["http://example.com/cb"])).toBe(false);
    expect(validRedirectUris(["https://example.com/cb#frag"])).toBe(false);
    expect(validRedirectUris(["https://user:pw@example.com/cb"])).toBe(false);
    expect(validRedirectUris(["/relative"])).toBe(false);
    expect(validRedirectUris(["javascript:alert(1)"])).toBe(false);
  });

  it("stores a public Ed25519 key, rebuilt from an allowlist, and refuses a private one", async () => {
    const pair = await generateClientKeyPair();
    const parsed = await parseClientJwks({ ...pair.publicJwk, extra: "dropped" });
    expect(parsed).toEqual({ keys: [pair.publicJwk] });

    expect(await parseClientJwks(pair.privateJwk)).toBe("private_key_not_public");
    expect(await parseClientJwks({ keys: [pair.publicJwk, pair.privateJwk] })).toBe(
      "private_key_not_public",
    );
    expect(await parseClientJwks({ kty: "RSA", n: "x", e: "AQAB" })).toBe("invalid_client_key");
    expect(await parseClientJwks({ kty: "OKP", crv: "Ed25519", x: "short" })).toBe(
      "invalid_client_key",
    );
    expect(await parseClientJwks({ keys: [] })).toBe("invalid_client_key");
  });

  it("names a key by its thumbprint when it arrives without a kid", async () => {
    const pair = await generateClientKeyPair();
    const { kid, ...withoutKid } = pair.publicJwk;
    const parsed = await parseClientJwks(withoutKid);
    expect(parsed).toEqual({ keys: [{ ...withoutKid, kid }] });
  });

  it("says which part of a registration is wrong", async () => {
    const pair = await generateClientKeyPair();
    const ok = {
      redirectUris: ["https://example.com/cb"],
      postLogoutRedirectUris: [],
      jwks: pair.publicJwk,
    };
    expect(await parseClientRegistration(ok)).toMatchObject({
      redirectUris: ["https://example.com/cb"],
    });
    expect(await parseClientRegistration({ ...ok, redirectUris: ["http://example.com/cb"] })).toBe(
      "invalid_redirect_uri",
    );
    expect(await parseClientRegistration({ ...ok, postLogoutRedirectUris: ["nope"] })).toBe(
      "invalid_post_logout_redirect_uri",
    );
    expect(await parseClientRegistration({ ...ok, jwks: null })).toMatchObject({ jwks: null });
  });

  it("round-trips the env value the key script prints", async () => {
    const pair = await generateClientKeyPair();
    expect(decodeClientKey(pair.envValue)).toEqual(pair.privateJwk);
    expect(pair.envValue).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("verifyClientAssertion (for brief 19's endpoints)", () => {
  let db: Database.Database;
  let key: JWK;

  beforeEach(async () => {
    db = freshDb();
    createApp(db, { slug: "atrium", name: "Atrium" });
    const pair = await generateClientKeyPair();
    key = pair.privateJwk;
    setOidcClient(db, "atrium", {
      redirectUris: ["https://example.com/cb"],
      postLogoutRedirectUris: [],
      jwks: { keys: [pair.publicJwk] },
    });
  });
  afterEach(() => {
    db.close();
  });

  async function assertion(
    claims: { iss?: string; sub?: string; aud?: string; exp?: string; alg?: string } = {},
    signingKey: JWK = key,
  ): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: claims.alg ?? "EdDSA", kid: signingKey.kid! })
      .setIssuer(claims.iss ?? "atrium")
      .setSubject(claims.sub ?? claims.iss ?? "atrium")
      .setAudience(claims.aud ?? ISSUER)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? "60s")
      .sign(await importJWK(signingKey, "EdDSA"));
  }

  it("accepts a fresh assertion once, and names the client", async () => {
    const jwt = await assertion();
    expect(await verifyClientAssertion(db, jwt, { audience: ISSUER })).toEqual({
      ok: true,
      clientId: "atrium",
    });
    expect(await verifyClientAssertion(db, jwt, { audience: ISSUER })).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("accepts both names for an Ed25519 signature", async () => {
    for (const alg of ["EdDSA", "Ed25519"]) {
      expect(
        await verifyClientAssertion(db, await assertion({ alg }), { audience: ISSUER }),
        alg,
      ).toMatchObject({ ok: true });
    }
  });

  it("refuses everything else with a reason", async () => {
    const other = (await generateClientKeyPair()).privateJwk;
    const cases: [string | undefined, string][] = [
      [undefined, "absent"],
      ["not.a.jwt", "malformed"],
      [await assertion({ iss: "prm" }), "unknown_client"],
      [await assertion({}, other), "invalid_signature"],
      [await assertion({ aud: "https://example.com/elsewhere" }), "invalid_claims"],
      [await assertion({ sub: "someone-else" }), "invalid_claims"],
      [await assertion({ exp: "-5m" }), "invalid_claims"],
    ];
    for (const [jwt, reason] of cases) {
      expect(await verifyClientAssertion(db, jwt, { audience: ISSUER }), reason).toEqual({
        ok: false,
        reason,
      });
    }
  });
});

describe("the issuer layout", () => {
  it("splits the issuer into the stripped prefix and Ward's /oidc mount", () => {
    const layout = oidcLayout(ISSUER, "https://example.com/ward/");
    expect(layout).toMatchObject({
      origin: "https://example.com",
      host: "example.com",
      protocol: "https",
      strippedPrefix: "/ward-api",
      issuerPath: "/ward-api/oidc",
      loginUrl: "https://example.com/ward/login",
    });
    expect(interactionUrl(layout, "abc")).toBe("https://example.com/ward-api/refresh/oidc/abc");
    expect(loginUrlFor(layout, "abc")).toBe("https://example.com/ward/login?oidc=abc");

    const direct = oidcLayout("http://localhost:8791/oidc", "http://localhost:8791/ward");
    expect(direct.strippedPrefix).toBe("");
    expect(interactionUrl(direct, "abc")).toBe("http://localhost:8791/refresh/oidc/abc");
  });

  it("rewrites a request to describe itself by the issuer, ignoring its own forwarded headers", () => {
    const layout = oidcLayout(ISSUER, "https://example.com/ward");
    const raw = {
      url: "/oidc/auth?client_id=atrium",
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
    } as unknown as Parameters<typeof rewriteForProvider>[0];
    rewriteForProvider(raw, layout);
    expect(raw.url).toBe("/auth?client_id=atrium");
    expect(raw.originalUrl).toBe("/ward-api/oidc/auth?client_id=atrium");
    expect(raw.headers["x-forwarded-host"]).toBe("example.com");
    expect(raw.headers["x-forwarded-proto"]).toBe("https");
  });
});
