import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, setOidcClient } from "../db/apps.js";
import { freshDb, seedUser } from "../db/test-support.js";
import { SqliteAdapter, claimReplayMarker, epochNow, sweepExpiredOidcRows } from "./adapter.js";
import { findAuthorization, recordAuthorization } from "./authorizations.js";

/**
 * The provider's storage. The end-to-end proof that it survives a restart is
 * in `oidc.test.ts`; this pins the adapter contract one method at a time,
 * against a migrated in-memory database.
 */

let db: Database.Database;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

describe("SqliteAdapter", () => {
  it("round-trips a payload, and answers nothing for another model's id", async () => {
    const codes = new SqliteAdapter(db, "AuthorizationCode");
    await codes.upsert("c1", { kind: "AuthorizationCode", jti: "c1", grantId: "g1" }, 60);

    expect(await codes.find("c1")).toEqual({ kind: "AuthorizationCode", jti: "c1", grantId: "g1" });
    expect(await new SqliteAdapter(db, "AccessToken").find("c1")).toBeUndefined();
  });

  it("marks a payload consumed, which the provider reads back to refuse a second use", async () => {
    const codes = new SqliteAdapter(db, "AuthorizationCode");
    await codes.upsert("c1", { jti: "c1" }, 60);
    await codes.consume("c1");
    expect((await codes.find("c1"))?.consumed).toBeTypeOf("number");
  });

  it("reads an expired row as absent before any sweep, and the sweep removes it", async () => {
    const sessions = new SqliteAdapter(db, "Session");
    await sessions.upsert("s1", { jti: "s1", uid: "u1" }, 60);
    db.prepare("UPDATE oidc_payloads SET expires_at = ?").run(epochNow() - 1);

    expect(await sessions.find("s1")).toBeUndefined();
    expect(await sessions.findByUid("u1")).toBeUndefined();
    expect(sweepExpiredOidcRows(db).payloads).toBe(1);
  });

  it("finds a session by uid", async () => {
    const sessions = new SqliteAdapter(db, "Session");
    await sessions.upsert("s1", { jti: "s1", uid: "u1" }, 60);
    expect((await sessions.findByUid("u1"))?.jti).toBe("s1");
  });

  it("revokes everything issued under a grant, and nothing else", async () => {
    await new SqliteAdapter(db, "AuthorizationCode").upsert("c1", { grantId: "g1" }, 60);
    await new SqliteAdapter(db, "AccessToken").upsert("a1", { grantId: "g1" }, 60);
    await new SqliteAdapter(db, "AccessToken").upsert("a2", { grantId: "g2" }, 60);

    await new SqliteAdapter(db, "Grant").revokeByGrantId("g1");

    expect(await new SqliteAdapter(db, "AuthorizationCode").find("c1")).toBeUndefined();
    expect(await new SqliteAdapter(db, "AccessToken").find("a1")).toBeUndefined();
    expect(await new SqliteAdapter(db, "AccessToken").find("a2")).toBeDefined();
  });

  it("reads clients from the apps table, and only apps set up as clients", async () => {
    createApp(db, { slug: "atrium", name: "Atrium" });
    const clients = new SqliteAdapter(db, "Client");
    expect(await clients.find("atrium")).toBeUndefined();

    setOidcClient(db, "atrium", {
      redirectUris: ["https://example.com/atrium/auth/ward/callback"],
      postLogoutRedirectUris: [],
      jwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: "x".repeat(43), kid: "k1" }] },
    });
    expect(await clients.find("atrium")).toMatchObject({
      client_id: "atrium",
      client_name: "Atrium",
      token_endpoint_auth_method: "private_key_jwt",
      id_token_signed_response_alg: "EdDSA",
    });
    await expect(clients.upsert("atrium", {}, 60)).rejects.toThrow(/console/);
  });
});

describe("replay markers", () => {
  it("accept an assertion once, until it expires", () => {
    const later = epochNow() + 60;
    expect(claimReplayMarker(db, "atrium", "j1", later)).toBe(true);
    expect(claimReplayMarker(db, "atrium", "j1", later)).toBe(false);
    expect(claimReplayMarker(db, "prm", "j1", later)).toBe(true);
    // Past the first marker's expiry the id is free again (the assertion's own
    // `exp` has long since refused it by then).
    expect(claimReplayMarker(db, "atrium", "j1", later + 120, later + 1)).toBe(true);
  });

  it("use the provider's own id and model, so the token endpoint sees them", async () => {
    claimReplayMarker(db, "atrium", "j1", epochNow() + 60);
    const { createHash } = await import("node:crypto");
    const id = createHash("sha256").update("atriumj1").digest("base64url");
    expect(await new SqliteAdapter(db, "ReplayDetection").find(id)).toMatchObject({
      kind: "ReplayDetection",
      iss: "atrium",
      jti: id,
    });
  });
});

describe("oidc_authorizations", () => {
  it("records the Ward session behind a grant, and forgets it on expiry", () => {
    createApp(db, { slug: "atrium", name: "Atrium" });
    const subject = seedUser(db, "alice").subject;
    const now = epochNow();
    recordAuthorization(db, {
      grantId: "g1",
      clientId: "atrium",
      subject,
      familyId: "f1",
      role: "admin",
      expiresAt: now + 600,
    });
    expect(findAuthorization(db, "g1", now)).toMatchObject({ family_id: "f1", role: "admin" });
    expect(findAuthorization(db, "g1", now + 601)).toBeUndefined();
    expect(sweepExpiredOidcRows(db, now + 601).authorizations).toBe(1);
  });
});
