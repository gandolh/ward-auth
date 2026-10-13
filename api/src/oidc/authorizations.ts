import type Database from "better-sqlite3";

import { prepareOnce } from "../db/prepared.js";

/**
 * `oidc_authorizations` — which Ward session an OIDC authorization rode on.
 *
 * The provider's own records know an account id and a grant. They do not know
 * Ward's refresh family, and the ID token has to carry it as `ward_sid`: it is
 * the id an app later asks Ward about (brief 19), and the reason a Ward sign-out
 * ends the app session within 30 seconds (decisions-oidc.md). The interaction
 * writes one row here per authorization, keyed by the grant it creates, and
 * `findAccount` reads it back when the code is exchanged.
 *
 * A row lives as long as the provider grant it names, and the same sweep
 * removes both.
 */

export interface OidcAuthorizationRow {
  grant_id: string;
  client_id: string;
  subject: string;
  family_id: string;
  role: string;
  expires_at: number;
}

const stmts = prepareOnce((db: Database.Database) => ({
  insert: db.prepare<[string, string, string, string, string, number]>(
    `INSERT INTO oidc_authorizations (grant_id, client_id, subject, family_id, role, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  byGrant: db.prepare<[string, number], OidcAuthorizationRow>(
    `SELECT * FROM oidc_authorizations WHERE grant_id = ? AND expires_at > ?`,
  ),
}));

export function recordAuthorization(
  db: Database.Database,
  input: {
    grantId: string;
    clientId: string;
    subject: string;
    familyId: string;
    role: string;
    expiresAt: number;
  },
): void {
  stmts(db).insert.run(
    input.grantId,
    input.clientId,
    input.subject,
    input.familyId,
    input.role,
    input.expiresAt,
  );
}

export function findAuthorization(
  db: Database.Database,
  grantId: string,
  now: number,
): OidcAuthorizationRow | undefined {
  return stmts(db).byGrant.get(grantId, now);
}
