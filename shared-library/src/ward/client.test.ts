import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createWardClient, wardClientOptionsFromEnv } from "./client.js";
import { WardConfigurationError, WardUnavailableError } from "./errors.js";
import { InvalidClientKeyError, importClientKey, signClientAssertion } from "./key.js";

/**
 * The Ward client without a Ward: configuration checks, the key, and the
 * session check's contract with a fake `fetch`. The flow against a real Ward
 * is `fastify/ward.test.ts`.
 */

function clientKeyPair(): { envValue: string; publicKey: ReturnType<typeof createPublicKey> } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as Record<string, string>;
  // Exactly the shape Ward's key script and the local seed write.
  const envValue = Buffer.from(
    JSON.stringify({ kty: "OKP", crv: "Ed25519", x: jwk["x"], d: jwk["d"], kid: "k1", use: "sig" }),
  ).toString("base64url");
  return { envValue, publicKey };
}

const ISSUER = "https://example.com/ward-api/oidc";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function client(fetch: typeof globalThis.fetch, now = () => 0) {
  return createWardClient({
    issuer: ISSUER,
    clientId: "myapp",
    clientKey: clientKeyPair().envValue,
    redirectUri: "https://example.com/myapp-api/auth/ward/callback",
    fetch,
    now,
  });
}

describe("the client key", () => {
  it("imports the seed's JWK shape and signs an assertion Ward can verify", async () => {
    const { envValue, publicKey } = clientKeyPair();
    const key = await importClientKey(envValue);
    expect(key.kid).toBe("k1");

    const assertion = await signClientAssertion(key, "myapp", ISSUER, 1_000);
    const [header, claims, signature] = assertion.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "EdDSA",
      kid: "k1",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "myapp",
      sub: "myapp",
      aud: ISSUER,
      iat: 1_000,
      exp: 1_060,
      jti: expect.any(String),
    });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("refuses a public half, another curve, garbage, and never echoes the value", async () => {
    const { envValue } = clientKeyPair();
    const jwk = JSON.parse(Buffer.from(envValue, "base64url").toString());
    const publicOnly = Buffer.from(JSON.stringify({ ...jwk, d: undefined })).toString("base64url");
    const rsa = Buffer.from(JSON.stringify({ ...jwk, kty: "RSA" })).toString("base64url");

    for (const value of [publicOnly, rsa, "not base64 json"]) {
      const error = await importClientKey(value).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidClientKeyError);
      expect(String((error as Error).message)).not.toContain(jwk.d);
    }
  });
});

describe("configuration", () => {
  it("requires an issuer ending in /oidc, https except on loopback", async () => {
    const base = {
      clientId: "myapp",
      clientKey: clientKeyPair().envValue,
      redirectUri: "https://example.com/cb",
    };
    await expect(
      createWardClient({ ...base, issuer: "https://example.com/ward-api" }),
    ).rejects.toThrow(/end in \/oidc/);
    await expect(
      createWardClient({ ...base, issuer: "http://example.com/ward-api/oidc" }),
    ).rejects.toThrow(/https/);
    // A name that only starts like a loopback address is a public host.
    for (const host of ["127.evil.com", "127.0.0.1.nip.io", "localhost.evil.com"]) {
      await expect(
        createWardClient({ ...base, issuer: `http://${host}/ward-api/oidc` }),
        host,
      ).rejects.toThrow(/https/);
    }
    for (const host of ["localhost:8792", "127.0.0.1:8792", "127.9.9.9", "[::1]:8792"]) {
      await expect(
        createWardClient({ ...base, issuer: `http://${host}/ward-api/oidc` }),
        host,
      ).resolves.toBeDefined();
    }
  });

  it("discovers a plain-HTTP issuer on loopback, as local development runs", async () => {
    const issuer = "http://localhost:8792/ward-api/oidc";
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toBe(`${issuer}/.well-known/openid-configuration`);
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/session/end`,
        id_token_signing_alg_values_supported: ["EdDSA"],
      });
    });
    const ward = await createWardClient({
      issuer,
      clientId: "myapp",
      clientKey: clientKeyPair().envValue,
      redirectUri: "http://localhost:5173/myapp-api/auth/ward/callback",
      fetch,
    });

    const { url, flow } = await ward.startAuthorization();
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${issuer}/auth`);
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      client_id: "myapp",
      response_type: "code",
      scope: "openid",
      code_challenge_method: "S256",
      state: flow.state,
      nonce: flow.nonce,
      redirect_uri: "http://localhost:5173/myapp-api/auth/ward/callback",
    });
    // Discovered once, and kept.
    await ward.startAuthorization();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("names a discovery document for another issuer as a configuration error", async () => {
    const ward = await client(async () =>
      json(200, { issuer: "https://elsewhere.example.com/oidc", authorization_endpoint: "x" }),
    );
    await expect(ward.startAuthorization()).rejects.toBeInstanceOf(WardConfigurationError);
  });

  it("reads the env set: nothing without an issuer, a clear error when incomplete", () => {
    expect(wardClientOptionsFromEnv({})).toBeUndefined();
    expect(() => wardClientOptionsFromEnv({ WARD_OIDC_ISSUER: ISSUER })).toThrow(
      /WARD_OIDC_CLIENT_ID, WARD_OIDC_CLIENT_KEY, WARD_OIDC_REDIRECT_URI/,
    );
    expect(
      wardClientOptionsFromEnv({
        WARD_OIDC_ISSUER: ISSUER,
        WARD_OIDC_CLIENT_ID: "myapp",
        WARD_OIDC_CLIENT_KEY: "k",
        WARD_OIDC_REDIRECT_URI: "https://example.com/cb",
        WARD_OIDC_POST_LOGOUT_REDIRECT_URI: "https://example.com/myapp/",
      }),
    ).toEqual({
      issuer: ISSUER,
      clientId: "myapp",
      clientKey: "k",
      redirectUri: "https://example.com/cb",
      postLogoutRedirectUri: "https://example.com/myapp/",
    });
  });
});

describe("checkSession", () => {
  it("posts the assertion with wardSid and subject to <issuer minus /oidc>/session-status", async () => {
    const fetch = vi.fn(async () => json(200, { active: true, role: "admin" }));
    const ward = await client(fetch);
    expect(await ward.checkSession("family", "subject")).toEqual({ active: true, role: "admin" });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/ward-api/session-status");
    expect(JSON.parse(String(init.body))).toEqual({
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      wardSid: "family",
      subject: "subject",
    });
  });

  it("caches an answer for 30 seconds per session, and not a failure", async () => {
    let clock = 0;
    let answer: () => Response = () => json(200, { active: true, role: "a" });
    const fetch = vi.fn(async () => answer());
    const ward = await client(fetch, () => clock);

    await ward.checkSession("f1", "s");
    clock += 29_999;
    await ward.checkSession("f1", "s");
    expect(fetch).toHaveBeenCalledTimes(1);
    await ward.checkSession("f2", "s");
    expect(fetch).toHaveBeenCalledTimes(2);

    clock += 1;
    answer = () => json(500, {});
    await expect(ward.checkSession("f1", "s")).rejects.toBeInstanceOf(WardUnavailableError);
    answer = () => json(200, { active: false });
    expect(await ward.checkSession("f1", "s")).toEqual({ active: false });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("fails closed on anything but a well-formed 200", async () => {
    const cases: Array<[() => Promise<Response>, typeof WardUnavailableError]> = [
      [async () => json(500, { error: "x" }), WardUnavailableError],
      [async () => json(404, {}), WardUnavailableError],
      [async () => new Response("not json", { status: 200 }), WardUnavailableError],
      [async () => json(200, { active: "yes" }), WardUnavailableError],
      [async () => json(200, { active: true }), WardUnavailableError],
      [
        async () => {
          throw new TypeError("fetch failed");
        },
        WardUnavailableError,
      ],
      [async () => json(401, { error: "invalid_client" }), WardConfigurationError],
    ];
    for (const [respond, expected] of cases) {
      const ward = await client(respond);
      await expect(ward.checkSession("f", "s")).rejects.toBeInstanceOf(expected);
    }
  });

  it("gives up after the timeout", async () => {
    const ward = await createWardClient({
      issuer: ISSUER,
      clientId: "myapp",
      clientKey: clientKeyPair().envValue,
      redirectUri: "https://example.com/cb",
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    });
    await expect(ward.checkSession("f", "s")).rejects.toBeInstanceOf(WardUnavailableError);
  });
});

describe("sendNotification", () => {
  it("sends exactly the three fields beside the credential, and maps Ward's answers", async () => {
    let answer = json(200, { sent: true });
    const fetch = vi.fn(async () => answer);
    const ward = await client(fetch);
    expect(await ward.sendNotification({ subject: "s", mailSubject: "Hi", text: "Hello" })).toEqual(
      {
        sent: true,
      },
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/ward-api/notify");
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual([
      "client_assertion",
      "client_assertion_type",
      "mailSubject",
      "subject",
      "text",
    ]);

    answer = json(503, { error: "mail_unavailable" });
    await expect(
      ward.sendNotification({ subject: "s", mailSubject: "Hi", text: "Hello" }),
    ).rejects.toBeInstanceOf(WardUnavailableError);
    answer = json(401, { error: "invalid_client" });
    await expect(
      ward.sendNotification({ subject: "s", mailSubject: "Hi", text: "Hello" }),
    ).rejects.toBeInstanceOf(WardConfigurationError);
  });
});
