import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { SignJWT, createLocalJWKSet, decodeJwt, importJWK, jwtVerify, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Ward as an OpenID Connect provider, end to end, through the real `buildApp()`.
 *
 * Same discipline as `integration/estate.test.ts`: a real on-disk database, a
 * real generated Ed25519 key, `app.inject()` and no port, and every import of
 * `config.js` dynamic so the environment below is in place first.
 *
 * ## The browser is simulated with external URLs
 *
 * Everything here is addressed the way a browser behind Caddy addresses it —
 * `https://ward.test/ward-api/oidc/auth`, not `/oidc/auth` — and `browser()`
 * strips `/ward-api` itself before injecting, exactly as `handle_path` does.
 * Its cookie jar honours `Path`, so a cookie scoped where the flow cannot see
 * it breaks the flow here too. That is the only way these tests can catch the
 * prefix bug class integrating.md rule 2 is about: an internal URL leaking into
 * a redirect fails the moment the test tries to follow it.
 */

const ORIGIN = "https://ward.test";
const STRIPPED = "/ward-api";
const ISSUER = `${ORIGIN}${STRIPPED}/oidc`;
const UI = `${ORIGIN}/ward`;
const APP_ORIGIN = "http://localhost:5173";
const REDIRECT_URI = `${APP_ORIGIN}/atrium/auth/ward/callback`;
const POST_LOGOUT_URI = `${APP_ORIGIN}/atrium/`;
const PASSWORD = "correct-horse-battery-staple";

let dir: string;
let app: FastifyInstance;
let db: Database.Database;
let clientKey: JWK;
let otherKey: JWK;

let mod: {
  buildApp: typeof import("../app.js").buildApp;
  users: typeof import("../db/users.js");
  grants: typeof import("../db/grants.js");
  apps: typeof import("../db/apps.js");
  refresh: typeof import("../db/refresh-tokens.js");
  resolve: typeof import("../grants/resolve.js");
  password: typeof import("../auth/password.js");
  keygen: typeof import("./client-keygen.js");
  superuser: typeof import("../auth/superuser.js");
  connection: typeof import("../db/connection.js");
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-oidc-"));
  process.env["PORT"] = "8799";
  process.env["HOST"] = "127.0.0.1";
  process.env["WARD_DB_PATH"] = join(dir, "ward.db");
  process.env["WARD_ADMIN_USERNAME"] = "break-glass";
  process.env["WARD_ADMIN_PASSWORD"] = "a-long-random-break-glass-password";
  process.env["WARD_SIGNING_KEY_PATH"] = join(dir, "signing-key.pem");
  process.env["WARD_PUBLIC_ORIGIN"] = ORIGIN;
  process.env["WARD_MAIL_TRANSPORT"] = "file";
  process.env["WARD_MAIL_FILE_DIR"] = join(dir, "mail");
  process.env["WARD_MAIL_FROM"] = "ward@example.com";
  process.env["WARD_OIDC_ISSUER"] = ISSUER;
  process.env["WARD_UI_URL"] = UI;

  const config = await import("../config.js");
  const { generateSigningKeyFile } = await import("../tokens/keygen.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  mod = {
    buildApp: (await import("../app.js")).buildApp,
    users: await import("../db/users.js"),
    grants: await import("../db/grants.js"),
    apps: await import("../db/apps.js"),
    refresh: await import("../db/refresh-tokens.js"),
    resolve: await import("../grants/resolve.js"),
    password: await import("../auth/password.js"),
    keygen: await import("./client-keygen.js"),
    superuser: await import("../auth/superuser.js"),
    connection: await import("../db/connection.js"),
  };

  db = await mod.connection.getDb();
  const { runMigrations } = await import("../db/migrate.js");
  runMigrations(db);

  app = await mod.buildApp();
  await app.ready();

  clientKey = (await mod.keygen.generateClientKeyPair()).privateJwk;
  otherKey = (await mod.keygen.generateClientKeyPair()).privateJwk;

  mod.apps.createApp(db, { slug: "atrium", name: "Atrium" });
  mod.apps.createApp(db, { slug: "prm", name: "Public Resource Map" });

  // Registered through the console route, the way an operator does it, with
  // the public half the key script prints.
  const consoleCookie = await consoleLogin();
  const publicJwk = { ...clientKey };
  delete publicJwk.d;
  const registered = await app.inject({
    method: "PUT",
    url: "/console/apps/atrium/oidc",
    headers: { cookie: `${mod.superuser.CONSOLE_COOKIE_NAME}=${consoleCookie}` },
    payload: {
      redirectUris: [REDIRECT_URI],
      postLogoutRedirectUris: [POST_LOGOUT_URI],
      jwks: publicJwk,
    },
  });
  expect(registered.statusCode, registered.body).toBe(200);
});

afterAll(async () => {
  await app?.close();
  mod?.connection.closeDb();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A browser: external URLs in, `handle_path` applied, a Path-aware cookie jar
// ---------------------------------------------------------------------------

interface StoredCookie {
  value: string;
  path: string;
}

class Browser {
  private readonly jar = new Map<string, StoredCookie>();

  /** Requests an external URL on Ward's origin, as Caddy would forward it. */
  async request(
    method: "GET" | "POST",
    url: string,
    form?: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    const target = new URL(url);
    expect(target.origin, `the browser only talks to Ward here: ${url}`).toBe(ORIGIN);
    expect(target.pathname.startsWith(`${STRIPPED}/`), `an API URL: ${url}`).toBe(true);

    const cookie = [...this.jar.entries()]
      .filter(([, stored]) => pathMatches(target.pathname, stored.path))
      .map(([name, stored]) => `${name}=${stored.value}`)
      .join("; ");

    const response = await app.inject({
      method,
      url: `${target.pathname.slice(STRIPPED.length)}${target.search}`,
      headers: {
        ...(cookie === "" ? {} : { cookie }),
        ...(form === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
        "x-forwarded-for": "203.0.113.9",
      },
      payload: form === undefined ? undefined : new URLSearchParams(form).toString(),
    });
    this.store(response);
    return response;
  }

  /** `POST /ward-api/login`, as Ward's login page sends it. */
  async signIn(username: string, password = PASSWORD): Promise<LightMyRequestResponse> {
    const response = await app.inject({
      method: "POST",
      url: "/login",
      headers: { "x-forwarded-for": "203.0.113.9" },
      payload: { username, password },
    });
    this.store(response);
    return response;
  }

  cookie(name: string): StoredCookie | undefined {
    return this.jar.get(name);
  }

  forget(name: string): void {
    this.jar.delete(name);
  }

  private store(response: LightMyRequestResponse): void {
    const raw = response.headers["set-cookie"];
    const headers = raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
    for (const header of headers) {
      const [pair, ...attributes] = header.split(";").map((part) => part.trim());
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      let path = "/";
      let expired = value === "";
      for (const attribute of attributes) {
        const [key, attributeValue = ""] = attribute.split("=");
        if (key!.toLowerCase() === "path") path = attributeValue;
        if (key!.toLowerCase() === "max-age" && Number(attributeValue) <= 0) expired = true;
        if (key!.toLowerCase() === "expires" && Date.parse(attributeValue) < Date.now()) {
          expired = true;
        }
      }
      if (expired) this.jar.delete(name);
      else this.jar.set(name, { value, path });
    }
  }
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

async function consoleLogin(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/console/login",
    headers: { "x-forwarded-for": "203.0.113.1" },
    payload: { username: "break-glass", password: "a-long-random-break-glass-password" },
  });
  expect(response.statusCode).toBe(200);
  const header = ([] as string[]).concat(response.headers["set-cookie"] as string | string[]);
  const pair = header.find((value) => value.startsWith(`${mod.superuser.CONSOLE_COOKIE_NAME}=`))!;
  return pair.split(";")[0]!.split("=")[1]!;
}

// ---------------------------------------------------------------------------
// The app's side: PKCE, the authorization URL, the client assertion
// ---------------------------------------------------------------------------

interface Started {
  url: string;
  verifier: string;
  state: string;
  nonce: string;
}

function startSignIn(overrides: Record<string, string | undefined> = {}): Started {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("base64url");
  const nonce = randomBytes(8).toString("base64url");
  const params: Record<string, string | undefined> = {
    client_id: "atrium",
    response_type: "code",
    scope: "openid",
    redirect_uri: REDIRECT_URI,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    nonce,
    ...overrides,
  };
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { url: `${ISSUER}/auth?${query.toString()}`, verifier, state, nonce };
}

async function clientAssertion(
  key: JWK = clientKey,
  claims: { iss?: string; aud?: string; jti?: string; alg?: "EdDSA" | "Ed25519" } = {},
): Promise<string> {
  const iss = claims.iss ?? "atrium";
  return new SignJWT({})
    .setProtectedHeader({ alg: claims.alg ?? "EdDSA", kid: key.kid! })
    .setIssuer(iss)
    .setSubject(iss)
    .setAudience(claims.aud ?? ISSUER)
    .setJti(claims.jti ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(await importJWK(key, "EdDSA"));
}

/** The token request an app's server makes: no browser, no cookies. */
async function exchange(
  code: string,
  verifier: string,
  assertion?: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: "/oidc/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: "atrium",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion ?? (await clientAssertion()),
    }).toString(),
  });
}

function location(response: LightMyRequestResponse): string {
  const value = response.headers.location;
  expect(
    value,
    `${response.statusCode} with a Location: ${response.body.slice(0, 300)}`,
  ).toBeTypeOf("string");
  return String(value);
}

/**
 * Follow the provider and the interaction until the browser leaves Ward's
 * origin, signing in at Ward's login page if it gets there. Returns the URL the
 * browser lands on at the app, and whether a password was asked for.
 */
async function runFlow(
  browser: Browser,
  started: Started,
  username?: string,
): Promise<{ landed: URL; askedForPassword: boolean }> {
  let url = started.url;
  let askedForPassword = false;
  for (let hop = 0; hop < 10; hop += 1) {
    const at = new URL(url);
    if (at.origin !== ORIGIN) return { landed: at, askedForPassword };

    if (at.pathname === "/ward/login") {
      askedForPassword = true;
      expect(username, "the flow asked for a password").toBeDefined();
      const uid = at.searchParams.get("oidc")!;
      const signedIn = await browser.signIn(username!);
      expect(signedIn.statusCode).toBe(200);
      // What Login.tsx does after a successful sign-in.
      url = `${ORIGIN}${STRIPPED}/refresh/oidc/${uid}`;
      continue;
    }

    let response = await browser.request("GET", url);
    // The provider's self-submitting form (it uses one to end its own session
    // when the account changes): do what the browser's script would.
    if (response.statusCode === 200 && /document\.forms\[0\]\.submit/.test(response.body)) {
      const action = /<form method="post" action="([^"]+)"/.exec(response.body)![1]!;
      const fields = Object.fromEntries(
        [...response.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)].map(
          (match) => [match[1]!, match[2]!],
        ),
      );
      response = await browser.request("POST", action.replaceAll("&amp;", "&"), fields);
    }
    expect([302, 303], `${url} → ${response.statusCode} ${response.body.slice(0, 300)}`).toContain(
      response.statusCode,
    );
    url = new URL(location(response), url).href;
  }
  throw new Error("the flow did not leave Ward in 10 hops");
}

async function newUser(username: string, roles: string[] = ["admin"]): Promise<string> {
  const user = mod.users.createUser(db, {
    username,
    passwordHash: await mod.password.hashPassword(PASSWORD),
    email: `${username}@example.com`,
  });
  for (const role of roles) {
    mod.grants.grantRole(db, {
      subject: user.subject,
      appSlug: "atrium",
      role,
      grantedBy: "superuser",
    });
  }
  return user.subject;
}

async function wardKeys(): Promise<ReturnType<typeof createLocalJWKSet>> {
  const jwks = await app.inject({ method: "GET", url: "/oidc/jwks" });
  expect(jwks.statusCode).toBe(200);
  return createLocalJWKSet(jwks.json());
}

// ---------------------------------------------------------------------------

describe("discovery and keys behind the stripped prefix", () => {
  it("advertises the configured issuer in every URL, whatever the request's own headers say", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/oidc/.well-known/openid-configuration",
      headers: {
        host: "127.0.0.1:8791",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
      },
    });
    expect(response.statusCode).toBe(200);
    const discovery = response.json<Record<string, unknown>>();

    expect(discovery["issuer"]).toBe(ISSUER);
    const urls = Object.entries(discovery).filter(
      ([, value]) => typeof value === "string" && /^https?:/.test(value),
    );
    expect(urls.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
        "end_session_endpoint",
      ]),
    );
    for (const [key, value] of urls) {
      if (key === "issuer") continue;
      expect(String(value).startsWith(`${ISSUER}/`), `${key}: ${String(value)}`).toBe(true);
    }

    expect(discovery["response_types_supported"]).toEqual(["code"]);
    expect(discovery["grant_types_supported"]).toEqual(["authorization_code"]);
    expect(discovery["code_challenge_methods_supported"]).toEqual(["S256"]);
    expect(discovery["token_endpoint_auth_methods_supported"]).toEqual(["private_key_jwt"]);
    expect(discovery["id_token_signing_alg_values_supported"]).toEqual(["EdDSA"]);
    expect(discovery["registration_endpoint"]).toBeUndefined();
    expect(discovery["claims_supported"]).not.toContain("email");
  });

  it("publishes Ward's existing signing key, and only its public half", async () => {
    const provider = (await app.inject({ method: "GET", url: "/oidc/jwks" })).json<{
      keys: Record<string, unknown>[];
    }>();
    const ward = (await app.inject({ method: "GET", url: "/.well-known/jwks.json" })).json<{
      keys: Record<string, unknown>[];
    }>();
    expect(provider.keys).toHaveLength(1);
    expect(provider.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA" });
    expect(provider.keys[0]!["kid"]).toBe(ward.keys[0]!["kid"]);
    expect(provider.keys[0]!["x"]).toBe(ward.keys[0]!["x"]);
    expect(provider.keys[0]).not.toHaveProperty("d");
  });
});

describe("sign in with Ward: code + PKCE", () => {
  let subject: string;

  beforeEach(() => {
    db.exec("DELETE FROM refresh_tokens");
  });

  beforeAll(async () => {
    subject = await newUser("alice");
  });

  it("asks for a password, then issues an EdDSA ID token with sub, ward_sid and ward_role", async () => {
    const browser = new Browser();
    const started = startSignIn();

    const { landed, askedForPassword } = await runFlow(browser, started, "alice");
    expect(askedForPassword).toBe(true);
    expect(`${landed.origin}${landed.pathname}`).toBe(REDIRECT_URI);
    expect(landed.searchParams.get("state")).toBe(started.state);
    expect(landed.searchParams.get("iss")).toBe(ISSUER);

    // The login page signs in through the ordinary cookie path, scoped where
    // it always was: the flow depends on no `Path=/` cookie.
    expect(browser.cookie("ward_refresh")?.path).toBe(`${STRIPPED}/refresh`);
    expect(browser.cookie("_session")?.path).toBe(`${STRIPPED}/oidc`);

    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.statusCode, token.body).toBe(200);
    const idToken = token.json<{ id_token: string }>().id_token;

    const { payload, protectedHeader } = await jwtVerify(idToken, await wardKeys(), {
      algorithms: ["EdDSA"],
      issuer: ISSUER,
      audience: "atrium",
    });
    expect(protectedHeader.alg).toBe("EdDSA");

    const family = mod.refresh.listLiveTokensForSubject(db, subject)[0]!.family_id;
    expect(payload.sub).toBe(subject);
    expect(payload["ward_sid"]).toBe(family);
    expect(payload["ward_role"]).toBe("admin");
    expect(payload["preferred_username"]).toBe("alice");
    expect(payload["nonce"]).toBe(started.nonce);
    expect(payload).not.toHaveProperty("email");
    expect(typeof payload["ward_sid"]).toBe("string");
    expect(typeof payload["ward_role"]).toBe("string");
  });

  it("with a live Ward session, completes without a password prompt and names that session", async () => {
    const browser = new Browser();
    await browser.signIn("alice");
    const family = mod.refresh.listLiveTokensForSubject(db, subject)[0]!.family_id;

    const started = startSignIn();
    const { landed, askedForPassword } = await runFlow(browser, started);
    expect(askedForPassword).toBe(false);

    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.statusCode, token.body).toBe(200);
    expect(decodeJwt(token.json<{ id_token: string }>().id_token)["ward_sid"]).toBe(family);
  });

  it("signs in whoever Ward says is signed in now, when the browser changes hands", async () => {
    const other = await newUser("alice2");
    const browser = new Browser();
    await runFlow(browser, startSignIn(), "alice");

    // Someone else signs in at Ward in the same browser, inside the provider
    // session's lifetime. The provider's session still names alice.
    await browser.signIn("alice2");
    const started = startSignIn();
    const { landed } = await runFlow(browser, started);
    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.statusCode, token.body).toBe(200);
    expect(decodeJwt(token.json<{ id_token: string }>().id_token).sub).toBe(other);
  });

  it("asks again for prompt=login even with a live session", async () => {
    const browser = new Browser();
    await browser.signIn("alice");
    // Signed in a minute ago: before the authorization began, which is what
    // `prompt=login` refuses. (Its resolution is the provider's, one second.)
    db.prepare(
      "UPDATE refresh_tokens SET issued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds')",
    ).run();
    const { askedForPassword } = await runFlow(browser, startSignIn({ prompt: "login" }), "alice");
    expect(askedForPassword).toBe(true);
  });

  it("does not lose the code across a restart", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");

    // A new process in everything but name: a fresh app and provider over the
    // same database file. The in-memory adapter would have lost the code here.
    await app.close();
    app = await mod.buildApp();
    await app.ready();

    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.statusCode, token.body).toBe(200);
  });

  it("does not lose an interaction across a restart", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const toInteraction = await browser.request("GET", started.url);
    const interaction = location(toInteraction);
    expect(interaction.startsWith(`${ORIGIN}${STRIPPED}/refresh/oidc/`)).toBe(true);

    await app.close();
    app = await mod.buildApp();
    await app.ready();

    await browser.signIn("alice");
    const { landed } = await runFlow(browser, { ...started, url: interaction });
    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.statusCode, token.body).toBe(200);
  });

  it("refuses a code twice, a wrong verifier and a missing challenge", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");
    const code = landed.searchParams.get("code")!;

    const wrong = await exchange(code, randomBytes(32).toString("base64url"));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: "invalid_grant" });

    const noPkce = await runFlow(
      browser,
      startSignIn({ code_challenge: undefined, code_challenge_method: undefined }),
    );
    expect(noPkce.landed.searchParams.get("error")).toBe("invalid_request");

    const second = startSignIn();
    const again = await runFlow(browser, second);
    const secondCode = again.landed.searchParams.get("code")!;
    expect((await exchange(secondCode, second.verifier)).statusCode).toBe(200);
    const replay = await exchange(secondCode, second.verifier);
    expect(replay.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("accepts a client assertion named Ed25519, as openid-client 6 signs it", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");
    const token = await exchange(
      landed.searchParams.get("code")!,
      started.verifier,
      await clientAssertion(clientKey, { alg: "Ed25519" }),
    );
    expect(token.statusCode, token.body).toBe(200);
  });

  it("will not take an assertion Ward's own check already spent (shared replay markers)", async () => {
    const { verifyClientAssertion } = await import("./client-auth.js");
    const assertion = await clientAssertion();
    expect(await verifyClientAssertion(db, assertion, { audience: ISSUER })).toEqual({
      ok: true,
      clientId: "atrium",
    });

    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");
    const token = await exchange(landed.searchParams.get("code")!, started.verifier, assertion);
    expect(token.statusCode).toBe(401);
    expect(token.json()).toMatchObject({ error: "invalid_client" });

    // And the other way round: spent at the token endpoint, refused by Ward's.
    const next = startSignIn();
    const second = await runFlow(browser, next);
    const fresh = await clientAssertion();
    expect(
      (await exchange(second.landed.searchParams.get("code")!, next.verifier, fresh)).statusCode,
    ).toBe(200);
    expect(await verifyClientAssertion(db, fresh, { audience: ISSUER })).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("refuses a client assertion signed by another key, for another audience, or used twice", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");
    const code = landed.searchParams.get("code")!;

    const forged = await exchange(code, started.verifier, await clientAssertion(otherKey));
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toMatchObject({ error: "invalid_client" });

    const internal = await exchange(
      code,
      started.verifier,
      await clientAssertion(clientKey, { aud: "http://127.0.0.1:8791/oidc" }),
    );
    expect(internal.json()).toMatchObject({ error: "invalid_client" });

    const assertion = await clientAssertion();
    expect((await exchange(code, started.verifier, assertion)).statusCode).toBe(200);
    const next = startSignIn();
    const second = await runFlow(browser, next);
    const replayed = await exchange(
      second.landed.searchParams.get("code")!,
      next.verifier,
      assertion,
    );
    expect(replayed.json()).toMatchObject({ error: "invalid_client" });
  });

  it("issues no token for a code whose Ward session ended before the exchange", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "alice");

    const logout = await app.inject({
      method: "POST",
      url: "/logout",
      headers: { cookie: `ward_refresh=${browser.cookie("ward_refresh")!.value}` },
    });
    expect(logout.statusCode).toBe(204);

    const token = await exchange(landed.searchParams.get("code")!, started.verifier);
    expect(token.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("access_denied", () => {
  it("for an account with no grant for the client's app", async () => {
    await newUser("bob", []);
    mod.grants.grantRole(db, {
      subject: mod.users.findUserByUsername(db, "bob")!.subject,
      appSlug: "prm",
      role: "user",
      grantedBy: "superuser",
    });
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "bob");
    expect(`${landed.origin}${landed.pathname}`).toBe(REDIRECT_URI);
    expect(landed.searchParams.get("error")).toBe("access_denied");
    expect(landed.searchParams.get("state")).toBe(started.state);
    expect(landed.searchParams.get("code")).toBeNull();
  });

  it("for a disabled account, even with its Ward session still live", async () => {
    const subject = await newUser("carol");
    const browser = new Browser();
    await browser.signIn("carol");
    mod.users.setDisabled(db, subject, true);

    const { landed } = await runFlow(browser, startSignIn());
    expect(landed.searchParams.get("error")).toBe("access_denied");
  });

  it("when the person cancels at Ward's login page", async () => {
    const browser = new Browser();
    const started = startSignIn();
    const interaction = location(await browser.request("GET", started.url));
    const toLogin = await browser.request("GET", interaction);
    expect(location(toLogin).startsWith(`${UI}/login?oidc=`)).toBe(true);

    const client = await browser.request("GET", `${interaction}/client`);
    expect(client.json()).toEqual({ clientId: "atrium", name: "Atrium" });

    const { landed } = await runFlow(browser, { ...started, url: `${interaction}/abort` });
    expect(landed.searchParams.get("error")).toBe("access_denied");
  });

  it("never redirects to an unregistered redirect URI or for an unknown client", async () => {
    const browser = new Browser();
    for (const overrides of [
      { redirect_uri: "https://evil.example/callback" },
      { redirect_uri: `${REDIRECT_URI}/extra` },
      { client_id: "prm" },
      { client_id: "nope" },
    ]) {
      const response = await browser.request("GET", startSignIn(overrides).url);
      expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(response.headers.location, JSON.stringify(overrides)).toBeUndefined();
    }
  });
});

describe("RP-initiated logout", () => {
  it("ends the Ward session named by the ID token, and returns to the registered URI", async () => {
    const subject = await newUser("dave");
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "dave");
    const idToken = (await exchange(landed.searchParams.get("code")!, started.verifier)).json<{
      id_token: string;
    }>().id_token;
    const family = String(decodeJwt(idToken)["ward_sid"]);
    expect(mod.resolve.hasLiveFamily(db, family, subject)).toBe(true);

    const end = await browser.request(
      "GET",
      `${ISSUER}/session/end?${new URLSearchParams({
        id_token_hint: idToken,
        post_logout_redirect_uri: POST_LOGOUT_URI,
        state: "bye",
      }).toString()}`,
    );
    expect(end.statusCode, end.body).toBe(200);
    expect(mod.resolve.hasLiveFamily(db, family, subject)).toBe(false);

    // The page submits itself; do what the browser would.
    const xsrf = /name="xsrf" value="([^"]+)"/.exec(end.body)![1]!;
    const action = /action="([^"]+)"/.exec(end.body)![1]!;
    expect(action.startsWith(`${ISSUER}/`)).toBe(true);
    const confirmed = await browser.request("POST", action, { xsrf, logout: "yes" });
    expect(confirmed.statusCode).toBe(303);
    expect(location(confirmed)).toBe(`${POST_LOGOUT_URI}?state=bye`);
  });

  it("still ends the Ward session long after the provider's own session is gone", async () => {
    const subject = await newUser("dana");
    const browser = new Browser();
    const started = startSignIn();
    const { landed } = await runFlow(browser, started, "dana");
    const idToken = (await exchange(landed.searchParams.get("code")!, started.verifier)).json<{
      id_token: string;
    }>().id_token;
    const family = String(decodeJwt(idToken)["ward_sid"]);

    // The usual case: the app signs out hours later, and the provider's
    // ten-minute session cookie is long gone.
    browser.forget("_session");
    browser.forget("_session.sig");

    const end = await browser.request(
      "GET",
      `${ISSUER}/session/end?${new URLSearchParams({
        id_token_hint: idToken,
        post_logout_redirect_uri: POST_LOGOUT_URI,
        state: "later",
      }).toString()}`,
    );
    expect(end.statusCode, end.body).toBe(200);
    expect(mod.resolve.hasLiveFamily(db, family, subject)).toBe(false);

    const xsrf = /name="xsrf" value="([^"]+)"/.exec(end.body)![1]!;
    const action = /action="([^"]+)"/.exec(end.body)![1]!;
    const confirmed = await browser.request("POST", action, { xsrf, logout: "yes" });
    expect(location(confirmed)).toBe(`${POST_LOGOUT_URI}?state=later`);
  });

  it("revokes nothing without an id_token_hint", async () => {
    const subject = await newUser("erin");
    const browser = new Browser();
    await browser.signIn("erin");
    const family = mod.refresh.listLiveTokensForSubject(db, subject)[0]!.family_id;

    const end = await browser.request("GET", `${ISSUER}/session/end?client_id=atrium`);
    expect(end.statusCode).toBe(200);
    expect(mod.resolve.hasLiveFamily(db, family, subject)).toBe(true);
  });
});

describe("the cookie surface the four apps use is unchanged", () => {
  it("still signs in, reads /session, refreshes and logs out", async () => {
    await newUser("frank");
    const browser = new Browser();
    const login = await browser.signIn("frank");
    expect(login.statusCode).toBe(200);
    const access = /ward_session=([^;]+)/.exec(String(login.headers["set-cookie"]))![1]!;

    const session = await app.inject({
      method: "GET",
      url: "/session",
      headers: { cookie: `ward_session=${access}` },
    });
    expect(session.json()).toMatchObject({ active: true });

    const refreshed = await app.inject({
      method: "POST",
      url: "/refresh",
      headers: {
        cookie: `ward_refresh=${browser.cookie("ward_refresh")!.value}`,
        "x-forwarded-for": "203.0.113.9",
      },
      payload: {},
    });
    expect(refreshed.statusCode).toBe(200);
  });
});
