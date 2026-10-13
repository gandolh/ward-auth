import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { SignJWT, importJWK, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp, setOidcClient } from "../db/apps.js";
import { countAudit } from "../db/audit-log.js";
import { grantRole, revokeGrant, SUPERUSER_ACTOR } from "../db/grants.js";
import {
  hashRefreshToken,
  generateRefreshToken,
  insertRefreshToken,
  newFamilyId,
  revokeAllForSubject,
  revokeFamily,
} from "../db/refresh-tokens.js";
import { freshDb, seedApps, seedUser } from "../db/test-support.js";
import { setDisabled, setPasswordHash, type UserRow } from "../db/users.js";
import { generateClientKeyPair } from "../oidc/client-keygen.js";
import { CLIENT_ASSERTION_TYPE } from "../oidc/client-auth.js";
import { sessionStatusRoutes } from "./session-status.js";

/**
 * `POST /session-status` against a Fastify instance this file builds and an
 * in-memory database. The route takes its database and issuer as options, so
 * nothing here imports `config.ts`. What a real `buildApp()` does with the
 * route is `session-status-app.test.ts`.
 *
 * Each "turns inactive" test ends a Ward session the way the real code does:
 * sign-out is `revokeFamily(.., "logout")`, a console revoke is the same with
 * `"admin"`, a password reset is `setPasswordHash` plus `revokeAllForSubject`
 * (`routes/admin/accounts.ts`, `routes/account.ts`).
 */

const ISSUER = "https://ward.test/ward-api/oidc";
const INACTIVE_BYTES = '{"active":false}';

let db: Database.Database;
let app: FastifyInstance;
let atriumKey: JWK;
let prmKey: JWK;
let strangerKey: JWK;

let alice: UserRow; // an atrium admin
let bob: UserRow; // an atrium user

async function keyPair(): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const pair = await generateClientKeyPair();
  return { privateJwk: pair.privateJwk, publicJwk: pair.publicJwk };
}

async function register(slug: string, publicJwk: JWK): Promise<void> {
  setOidcClient(db, slug, {
    redirectUris: [`http://localhost:5173/${slug}/auth/ward/callback`],
    postLogoutRedirectUris: [],
    jwks: { keys: [publicJwk as Record<string, unknown>] },
  });
}

/** What an app's server signs: the same assertion it presents at the token endpoint. */
async function assertion(
  key: JWK,
  claims: {
    iss?: string;
    aud?: string;
    jti?: string;
    alg?: "EdDSA" | "Ed25519";
    exp?: string;
  } = {},
): Promise<string> {
  const iss = claims.iss ?? "atrium";
  return new SignJWT({})
    .setProtectedHeader({ alg: claims.alg ?? "EdDSA", kid: key.kid! })
    .setIssuer(iss)
    .setSubject(iss)
    .setAudience(claims.aud ?? ISSUER)
    .setJti(claims.jti ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "60s")
    .sign(await importJWK(key, "EdDSA"));
}

/** A live Ward session for `user`: one refresh row in a fresh family. */
function signIn(user: UserRow, expiresAt = new Date(Date.now() + 3_600_000).toISOString()): string {
  const familyId = newFamilyId();
  insertRefreshToken(db, {
    tokenHash: hashRefreshToken(generateRefreshToken()),
    subject: user.subject,
    familyId,
    expiresAt,
  });
  return familyId;
}

async function ask(body: unknown, on: FastifyInstance = app): Promise<LightMyRequestResponse> {
  return on.inject({
    method: "POST",
    url: "/session-status",
    payload: body as Record<string, unknown>,
  });
}

/** A well-formed, correctly authenticated call from atrium. */
async function status(
  wardSid: string,
  subject: string,
  overrides: Record<string, unknown> = {},
  key: JWK = atriumKey,
  clientId = "atrium",
): Promise<LightMyRequestResponse> {
  return ask({
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await assertion(key, { iss: clientId }),
    wardSid,
    subject,
    ...overrides,
  });
}

beforeAll(async () => {
  db = freshDb();
  seedApps(db);
  createApp(db, { slug: "stranger", name: "Not registered as a client" });

  const atrium = await keyPair();
  const prm = await keyPair();
  atriumKey = atrium.privateJwk;
  prmKey = prm.privateJwk;
  strangerKey = (await keyPair()).privateJwk;
  await register("atrium", atrium.publicJwk);
  await register("prm", prm.publicJwk);

  alice = seedUser(db, "alice", "alice@example.com");
  grantRole(db, {
    subject: alice.subject,
    appSlug: "atrium",
    role: "admin",
    grantedBy: SUPERUSER_ACTOR,
  });
  bob = seedUser(db, "bob", "bob@example.com");
  grantRole(db, {
    subject: bob.subject,
    appSlug: "atrium",
    role: "user",
    grantedBy: SUPERUSER_ACTOR,
  });

  app = Fastify({ logger: false });
  await app.register(sessionStatusRoutes, { db, issuer: ISSUER });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  db?.close();
});

beforeEach(() => {
  db.exec("DELETE FROM audit_log;");
});

describe("a live session", () => {
  it("is active, with the role the account holds in the calling app", async () => {
    const response = await status(signIn(alice), alice.subject);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ active: true, role: "admin" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("answers for the calling client's app, whatever the body says", async () => {
    // alice holds atrium only. prm's client asking about her is "no grant",
    // and naming atrium in the body does not borrow atrium's grant.
    const sid = signIn(alice);
    const asPrm = await status(
      sid,
      alice.subject,
      { app: "atrium", appSlug: "atrium" },
      prmKey,
      "prm",
    );
    expect(asPrm.body).toBe(INACTIVE_BYTES);

    grantRole(db, {
      subject: alice.subject,
      appSlug: "prm",
      role: "user",
      grantedBy: SUPERUSER_ACTOR,
    });
    const now = await status(sid, alice.subject, {}, prmKey, "prm");
    expect(now.json()).toEqual({ active: true, role: "user" });
    revokeGrant(db, alice.subject, "prm", "user");
  });

  it("accepts an assertion named Ed25519, as openid-client 6 signs it", async () => {
    const response = await status(signIn(alice), alice.subject, {
      client_assertion: await assertion(atriumKey, { alg: "Ed25519" }),
    });
    expect(response.json()).toEqual({ active: true, role: "admin" });
  });

  it("writes no audit row, like /introspect", async () => {
    await status(signIn(alice), alice.subject);
    expect(countAudit(db)).toBe(0);
  });
});

describe("what turns active false", () => {
  it("a sign-out", async () => {
    const sid = signIn(alice);
    expect((await status(sid, alice.subject)).json()).toMatchObject({ active: true });

    revokeFamily(db, sid, "logout");
    expect((await status(sid, alice.subject)).body).toBe(INACTIVE_BYTES);
  });

  it("a console revoke of that session, and only that one", async () => {
    const first = signIn(alice);
    const second = signIn(alice);

    revokeFamily(db, first, "admin");

    expect((await status(first, alice.subject)).body).toBe(INACTIVE_BYTES);
    expect((await status(second, alice.subject)).json()).toMatchObject({ active: true });
  });

  it("a password change, which ends every session", async () => {
    const sid = signIn(bob);
    setPasswordHash(db, bob.subject, "scrypt$a-new-hash");
    revokeAllForSubject(db, bob.subject, "admin");

    expect((await status(sid, bob.subject)).body).toBe(INACTIVE_BYTES);
  });

  it("a removed grant, and a restored one brings it back", async () => {
    const sid = signIn(bob);
    revokeGrant(db, bob.subject, "atrium", "user");
    expect((await status(sid, bob.subject)).body).toBe(INACTIVE_BYTES);

    grantRole(db, {
      subject: bob.subject,
      appSlug: "atrium",
      role: "user",
      grantedBy: SUPERUSER_ACTOR,
    });
    expect((await status(sid, bob.subject)).json()).toEqual({ active: true, role: "user" });
  });

  it("a disabled account, even with a live family", async () => {
    const sid = signIn(bob);
    setDisabled(db, bob.subject, true);
    expect((await status(sid, bob.subject)).body).toBe(INACTIVE_BYTES);

    setDisabled(db, bob.subject, false);
    expect((await status(sid, bob.subject)).json()).toMatchObject({ active: true });
  });

  it("a lapsed family", async () => {
    const sid = signIn(alice, new Date(Date.now() - 1000).toISOString());
    expect((await status(sid, alice.subject)).body).toBe(INACTIVE_BYTES);
  });

  it("a subject that is not the family's", async () => {
    // bob holds an atrium grant and a live session of his own; alice's family
    // is not his.
    const alices = signIn(alice);
    signIn(bob);
    expect((await status(alices, bob.subject)).body).toBe(INACTIVE_BYTES);
  });

  it("a family or subject that does not exist", async () => {
    expect((await status("0".repeat(32), alice.subject)).body).toBe(INACTIVE_BYTES);
    expect((await status(signIn(alice), "0".repeat(32))).body).toBe(INACTIVE_BYTES);
  });

  it("no grant in the calling app, though the account is fine", async () => {
    const carol = seedUser(db, "carol");
    expect((await status(signIn(carol), carol.subject)).body).toBe(INACTIVE_BYTES);
  });
});

describe("one answer for every no", () => {
  it("is the same bytes for every kind of no", async () => {
    const sid = signIn(alice);
    const dead = signIn(alice);
    revokeFamily(db, dead, "logout");
    const carol = seedUser(db, "dana");

    const bodies = new Set<string>();
    for (const response of [
      await status(dead, alice.subject),
      await status(sid, bob.subject),
      await status(sid, carol.subject),
      await status("nope", alice.subject),
      await status(sid, "nobody"),
      await status(sid, alice.subject, { wardSid: undefined }),
      await status(sid, alice.subject, { subject: undefined }),
      await status(sid, alice.subject, { wardSid: 42 }),
      await status(sid, alice.subject, { subject: ["a"] }),
      await status(sid, alice.subject, { wardSid: "" }),
      await status(sid, alice.subject, { wardSid: "x".repeat(129) }),
    ]) {
      expect(response.statusCode).toBe(200);
      bodies.add(response.body);
    }
    expect([...bodies]).toEqual([INACTIVE_BYTES]);
  });

  it("answers a malformed body from an authenticated caller with active false", async () => {
    const credentials = {
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: await assertion(atriumKey),
    };
    expect((await ask(credentials)).body).toBe(INACTIVE_BYTES);
  });
});

describe("client authentication", () => {
  async function expectRefused(response: LightMyRequestResponse, label: string): Promise<void> {
    expect(response.statusCode, label).toBe(401);
    expect(response.body, label).toBe('{"error":"invalid_client"}');
    expect(response.headers["cache-control"], label).toBe("no-store");
  }

  it("refuses a call with no credential at all", async () => {
    const sid = signIn(alice);
    await expectRefused(await ask({ wardSid: sid, subject: alice.subject }), "no fields");
    await expectRefused(await ask({}), "empty object");
    await expectRefused(
      await app.inject({ method: "POST", url: "/session-status" }),
      "no body at all",
    );
  });

  it("refuses a body that is not JSON, with the same 401 rather than Fastify's 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session-status",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    await expectRefused(response, "unparseable");
  });

  it("refuses a wrong type, a malformed assertion, an unregistered client and a stranger's key", async () => {
    const sid = signIn(alice);
    const cases: [string, Record<string, unknown>][] = [
      [
        "wrong type",
        { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:saml2-bearer" },
      ],
      ["no type", { client_assertion_type: undefined }],
      ["not a jwt", { client_assertion: "not-a-jwt" }],
      ["empty", { client_assertion: "" }],
      ["not a string", { client_assertion: 7 }],
      ["too long", { client_assertion: "a".repeat(9000) }],
      ["signed by another key", { client_assertion: await assertion(strangerKey) }],
      [
        "an unknown client",
        { client_assertion: await assertion(strangerKey, { iss: "no-such-app" }) },
      ],
      [
        "an app that is not a client",
        { client_assertion: await assertion(strangerKey, { iss: "stranger" }) },
      ],
      ["another client's key", { client_assertion: await assertion(prmKey) }],
    ];
    for (const [label, overrides] of cases) {
      await expectRefused(await status(sid, alice.subject, overrides), label);
    }
  });

  it("refuses a wrong audience, including the internal token endpoint URL", async () => {
    const sid = signIn(alice);
    for (const aud of [
      "https://ward.test/other",
      "http://127.0.0.1:8791/oidc",
      `${ISSUER}/token`,
    ]) {
      const response = await status(sid, alice.subject, {
        client_assertion: await assertion(atriumKey, { aud }),
      });
      await expectRefused(response, aud);
    }
  });

  it("refuses an expired assertion and a replayed one", async () => {
    const sid = signIn(alice);
    const expired = await assertion(atriumKey, { exp: "-1h" });
    await expectRefused(await status(sid, alice.subject, { client_assertion: expired }), "expired");

    const once = await assertion(atriumKey);
    const first = await status(sid, alice.subject, { client_assertion: once });
    expect(first.statusCode).toBe(200);
    await expectRefused(await status(sid, alice.subject, { client_assertion: once }), "replayed");
  });

  it("is a 401 before the session is looked at, so a dead session never reads as a bad client", async () => {
    const dead = signIn(alice);
    revokeFamily(db, dead, "logout");
    await expectRefused(
      await status(dead, alice.subject, { client_assertion: "not-a-jwt" }),
      "bad client, dead session",
    );
    expect((await status(dead, alice.subject)).statusCode).toBe(200);
  });

  it("does not answer a GET", async () => {
    const response = await app.inject({ method: "GET", url: "/session-status" });
    expect(response.statusCode).toBe(404);
  });
});
