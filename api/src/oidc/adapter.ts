import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Adapter, AdapterPayload } from "oidc-provider";

import { getApp } from "../db/apps.js";
import { prepareOnce } from "../db/prepared.js";
import { clientMetadataFor } from "./clients.js";

/**
 * `oidc-provider`'s storage, on Ward's own better-sqlite3 handle.
 *
 * The library's default adapter is an in-process LRU map, and the brief's
 * acceptance names what that costs: a restart between "the provider issued a
 * code" and "the app exchanged it" loses the code. Everything the provider
 * persists — sessions, interactions, codes, grants, access tokens, the
 * replay markers that stop a client assertion being used twice — goes through
 * here into `oidc_payloads` instead.
 *
 * ## One table, keyed by (model, id)
 *
 * The provider asks for one adapter per model and treats each as its own id
 * space. A single table with the model name in the key gives exactly that,
 * and one expiry sweep covers all of it. The three secondary lookups the
 * adapter contract needs (`grantId`, `uid`, `userCode`) are lifted out of the
 * JSON into indexed columns so none of them is a scan.
 *
 * ## Clients are not stored here
 *
 * The `Client` model reads the `apps` table instead (`clients.ts`). A client
 * *is* an app, edited in the console, and a second copy of its metadata would
 * be a second answer to "which redirect URIs does atrium have".
 *
 * ## Synchronous underneath
 *
 * Every method is `async` because the contract says so, but each body is one
 * synchronous better-sqlite3 statement, so nothing interleaves inside one —
 * the property decisions-implementation.md chose this driver for. A code's
 * `consume` followed by a second exchange of the same code is still caught by
 * the provider's own consumed check, which reads `consumed` back from `find`.
 */

/** Models whose rows hang off a grant and die with it in `revokeByGrantId`. */
const GRANTABLE = [
  "AccessToken",
  "AuthorizationCode",
  "RefreshToken",
  "DeviceCode",
  "BackchannelAuthenticationRequest",
  "PreAuthorizedCode",
] as const;

interface StoredRow {
  payload: string;
  consumed_at: number | null;
}

const stmts = prepareOnce((db: Database.Database) => ({
  upsert: db.prepare<
    [string, string, string, string | null, string | null, string | null, number | null]
  >(
    `INSERT INTO oidc_payloads (model, id, payload, grant_id, uid, user_code, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (model, id) DO UPDATE SET
       payload = excluded.payload,
       grant_id = excluded.grant_id,
       uid = excluded.uid,
       user_code = excluded.user_code,
       expires_at = excluded.expires_at,
       consumed_at = NULL`,
  ),

  // Expired rows read as absent even before the sweep reaches them, so the
  // sweep's timing is never a correctness question.
  byId: db.prepare<[string, string, number], StoredRow>(
    `SELECT payload, consumed_at FROM oidc_payloads
      WHERE model = ? AND id = ? AND (expires_at IS NULL OR expires_at > ?)`,
  ),

  byUid: db.prepare<[string, string, number], StoredRow>(
    `SELECT payload, consumed_at FROM oidc_payloads
      WHERE model = ? AND uid = ? AND (expires_at IS NULL OR expires_at > ?)`,
  ),

  byUserCode: db.prepare<[string, string, number], StoredRow>(
    `SELECT payload, consumed_at FROM oidc_payloads
      WHERE model = ? AND user_code = ? AND (expires_at IS NULL OR expires_at > ?)`,
  ),

  consume: db.prepare<[number, string, string]>(
    `UPDATE oidc_payloads SET consumed_at = ? WHERE model = ? AND id = ?`,
  ),

  destroy: db.prepare<[string, string]>(`DELETE FROM oidc_payloads WHERE model = ? AND id = ?`),

  revokeByGrant: db.prepare<[string]>(
    `DELETE FROM oidc_payloads
      WHERE grant_id = ? AND model IN (${GRANTABLE.map((model) => `'${model}'`).join(", ")})`,
  ),

  // Insert a replay marker, or take over one that has already expired. A live
  // marker with the same id makes this change nothing, which is the answer.
  claimReplay: db.prepare<[string, string, number, number]>(
    `INSERT INTO oidc_payloads (model, id, payload, expires_at)
     VALUES ('ReplayDetection', ?, ?, ?)
     ON CONFLICT (model, id) DO UPDATE SET
       payload = excluded.payload, expires_at = excluded.expires_at, consumed_at = NULL
     WHERE oidc_payloads.expires_at IS NOT NULL AND oidc_payloads.expires_at <= ?`,
  ),

  sweepPayloads: db.prepare<[number]>(`DELETE FROM oidc_payloads WHERE expires_at <= ?`),
  sweepAuthorizations: db.prepare<[number]>(
    `DELETE FROM oidc_authorizations WHERE expires_at <= ?`,
  ),
}));

/** Epoch seconds, the provider's unit. */
export function epochNow(): number {
  return Math.floor(Date.now() / 1000);
}

function decode(row: StoredRow | undefined): AdapterPayload | undefined {
  if (row === undefined) return undefined;
  const payload = JSON.parse(row.payload) as AdapterPayload;
  return row.consumed_at === null ? payload : { ...payload, consumed: row.consumed_at };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class SqliteAdapter implements Adapter {
  constructor(
    private readonly db: Database.Database,
    private readonly model: string,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    this.refuseClientWrites();
    stmts(this.db).upsert.run(
      this.model,
      id,
      JSON.stringify(payload),
      optionalString(payload.grantId),
      optionalString(payload.uid),
      optionalString(payload.userCode),
      typeof expiresIn === "number" ? epochNow() + expiresIn : null,
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (this.model === "Client") return this.findClient(id);
    return decode(stmts(this.db).byId.get(this.model, id, epochNow()));
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return decode(stmts(this.db).byUid.get(this.model, uid, epochNow()));
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return decode(stmts(this.db).byUserCode.get(this.model, userCode, epochNow()));
  }

  async consume(id: string): Promise<void> {
    stmts(this.db).consume.run(epochNow(), this.model, id);
  }

  async destroy(id: string): Promise<void> {
    this.refuseClientWrites();
    stmts(this.db).destroy.run(this.model, id);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    stmts(this.db).revokeByGrant.run(grantId);
  }

  private findClient(id: string): AdapterPayload | undefined {
    const row = getApp(this.db, id);
    if (row === undefined) return undefined;
    return clientMetadataFor(row) as AdapterPayload | undefined;
  }

  /**
   * Dynamic registration is off, so nothing in the provider should ever write
   * a client. If something does, failing loudly beats writing a row the
   * `apps` table knows nothing about.
   */
  private refuseClientWrites(): void {
    if (this.model === "Client") {
      throw new Error(
        "OIDC clients are apps; they are written through the console, not the adapter",
      );
    }
  }
}

/** The factory `oidc-provider` takes as its `adapter` setting. */
export function sqliteAdapterFactory(db: Database.Database): (model: string) => Adapter {
  return (model) => new SqliteAdapter(db, model);
}

/**
 * Record that a client assertion `(iss, jti)` has been used, and say whether
 * this was its first use.
 *
 * The same row the provider's own `ReplayDetection.unique` writes — model
 * `ReplayDetection`, id `base64url(sha256(iss + jti))`, the same payload
 * shape — so one assertion cannot be spent once at the token endpoint and
 * again at an endpoint Ward checks itself (`client-auth.ts`), in either order.
 * One statement, so two concurrent presentations cannot both see "unused".
 */
export function claimReplayMarker(
  db: Database.Database,
  iss: string,
  jti: string,
  expiresAt: number,
  now: number = epochNow(),
): boolean {
  const id = createHash("sha256").update(`${iss}${jti}`).digest("base64url");
  const payload = JSON.stringify({
    iat: now,
    exp: expiresAt,
    jti: id,
    kind: "ReplayDetection",
    iss,
  });
  return stmts(db).claimReplay.run(id, payload, expiresAt, now).changes === 1;
}

/**
 * Delete every expired provider row and Ward authorization. Run at boot and
 * then on a timer by `routes.ts`. Reads already ignore expired rows, so this
 * is housekeeping, not a security control: it keeps the table from growing by
 * one row per sign-in forever.
 */
export function sweepExpiredOidcRows(
  db: Database.Database,
  now: number = epochNow(),
): { payloads: number; authorizations: number } {
  return db.transaction(() => ({
    payloads: stmts(db).sweepPayloads.run(now).changes,
    authorizations: stmts(db).sweepAuthorizations.run(now).changes,
  }))();
}
