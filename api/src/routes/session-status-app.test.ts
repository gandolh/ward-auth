import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { SignJWT, importJWK, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `POST /session-status` through the real `buildApp()`, with `WARD_OIDC_ISSUER`
 * set: the route is mounted, reads the issuer from configuration, and answers
 * with the app's own client key. `session-status.test.ts` covers the answers;
 * this proves the wiring in `app.ts`. Every import of `config.js` is dynamic
 * so the environment below is in place first (see `integration/estate.test.ts`).
 *
 * `session-status-unmounted.test.ts` is the same wiring with the issuer unset.
 */

const ORIGIN = "https://ward.test";
const ISSUER = `${ORIGIN}/ward-api/oidc`;

let dir: string;
let app: FastifyInstance;
let clientKey: JWK;
let subject: string;
let wardSid: string;
let closeDb: () => void;

async function assertion(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: clientKey.kid! })
    .setIssuer("atrium")
    .setSubject("atrium")
    .setAudience(ISSUER)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(await importJWK(clientKey, "EdDSA"));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-session-status-"));
  process.env["PORT"] = "8797";
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
  process.env["WARD_UI_URL"] = `${ORIGIN}/ward`;

  const config = await import("../config.js");
  const { generateSigningKeyFile } = await import("../tokens/keygen.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  const connection = await import("../db/connection.js");
  closeDb = connection.closeDb;
  const db = await connection.getDb();
  (await import("../db/migrate.js")).runMigrations(db);

  const apps = await import("../db/apps.js");
  const refresh = await import("../db/refresh-tokens.js");
  const pair = await (await import("../oidc/client-keygen.js")).generateClientKeyPair();
  clientKey = pair.privateJwk;
  apps.createApp(db, { slug: "atrium", name: "Atrium" });
  apps.setOidcClient(db, "atrium", {
    redirectUris: ["http://localhost:5173/atrium/auth/ward/callback"],
    postLogoutRedirectUris: [],
    jwks: { keys: [pair.publicJwk] },
  });

  const user = (await import("../db/users.js")).createUser(db, {
    username: "alice",
    passwordHash: "scrypt$not-a-real-hash$alice",
    email: null,
  });
  subject = user.subject;
  (await import("../db/grants.js")).grantRole(db, {
    subject,
    appSlug: "atrium",
    role: "admin",
    grantedBy: "superuser",
  });
  wardSid = refresh.newFamilyId();
  refresh.insertRefreshToken(db, {
    tokenHash: refresh.hashRefreshToken(refresh.generateRefreshToken()),
    subject,
    familyId: wardSid,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  app = await (await import("../app.js")).buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  closeDb?.();
  await rm(dir, { recursive: true, force: true });
});

describe("POST /session-status in the real app", () => {
  it("is mounted and answers an authenticated app", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session-status",
      payload: {
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(),
        wardSid,
        subject,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ active: true, role: "admin" });
  });

  it("refuses an unauthenticated caller with 401 invalid_client", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session-status",
      payload: { wardSid, subject },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_client" });
  });

  it("lets /notify take the same assertion, with the issuer from configuration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/notify",
      payload: {
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(),
        subject,
        mailSubject: "Hello",
        text: "Hello",
      },
    });
    // Authenticated; alice has no verified address, so the mail is refused.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: false });
  });
});
