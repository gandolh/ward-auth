import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * With `WARD_OIDC_ISSUER` unset, `POST /session-status` does not exist: no
 * issuer to name as the audience and no clients, so Fastify answers `404`, as
 * it does for the provider's own routes. `/notify` has nothing to verify an
 * assertion against and refuses one as `invalid_client`. See `session-status-app.test.ts` for the mounted app.
 */

let dir: string;
let app: FastifyInstance;
let closeDb: () => void;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-session-status-off-"));
  process.env["PORT"] = "8796";
  process.env["HOST"] = "127.0.0.1";
  process.env["WARD_DB_PATH"] = join(dir, "ward.db");
  process.env["WARD_ADMIN_USERNAME"] = "break-glass";
  process.env["WARD_ADMIN_PASSWORD"] = "a-long-random-break-glass-password";
  process.env["WARD_SIGNING_KEY_PATH"] = join(dir, "signing-key.pem");
  process.env["WARD_PUBLIC_ORIGIN"] = "https://ward.test";
  process.env["WARD_MAIL_TRANSPORT"] = "file";
  process.env["WARD_MAIL_FILE_DIR"] = join(dir, "mail");
  process.env["WARD_MAIL_FROM"] = "ward@example.com";
  delete process.env["WARD_OIDC_ISSUER"];
  delete process.env["WARD_UI_URL"];

  const config = await import("../config.js");
  const { generateSigningKeyFile } = await import("../tokens/keygen.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  const connection = await import("../db/connection.js");
  closeDb = connection.closeDb;
  (await import("../db/migrate.js")).runMigrations(await connection.getDb());

  app = await (await import("../app.js")).buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  closeDb?.();
  await rm(dir, { recursive: true, force: true });
});

describe("with no OpenID Connect issuer configured", () => {
  it("has no /session-status route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session-status",
      payload: { wardSid: "x", subject: "y" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("refuses a client assertion at /notify as invalid_client", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/notify",
      payload: {
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: "a.b.c",
        subject: "x",
        mailSubject: "Hello",
        text: "Hello",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_client" });
  });
});
