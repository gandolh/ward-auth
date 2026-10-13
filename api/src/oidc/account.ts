import type Database from "better-sqlite3";
import type { Account, FindAccount, KoaContextWithOIDC } from "oidc-provider";

import { hashRefreshToken, findRefreshToken, listFamily } from "../db/refresh-tokens.js";
import { listRolesInApp } from "../db/grants.js";
import { findUserBySubject, type UserRow } from "../db/users.js";
import { hasLiveFamily } from "../grants/resolve.js";
import { epochNow } from "./adapter.js";
import { findAuthorization } from "./authorizations.js";

/**
 * Accounts for the provider, and the one question the interaction asks:
 * is this browser signed in at Ward?
 *
 * **Ward's refresh family is the authority on "signed in at Ward"**
 * (decisions-oidc.md). The provider keeps a session of its own, and two notions
 * of signed-in would let one end while the other lives on, so the interaction
 * never trusts the provider's: it reads the refresh cookie every time.
 */

export interface WardBrowserSession {
  subject: string;
  familyId: string;
  user: UserRow;
  /** When the family was born — the person's last password entry. Epoch seconds. */
  authTime: number;
}

/**
 * The Ward session behind a presented refresh token, or `undefined` for none.
 *
 * Peeks; never rotates. The interaction is a navigation the person did not
 * initiate as a refresh, and rotating here would race the account page's own
 * refresh in another tab into the reuse alarm. A revoked or lapsed row is no
 * session. A **disabled** account is returned as found, so the caller can
 * refuse it with `access_denied` rather than sending its holder to a sign-in
 * form that will only say the account is off.
 */
export function wardSessionFor(
  db: Database.Database,
  presented: string | undefined,
  now: Date = new Date(),
): WardBrowserSession | undefined {
  if (presented === undefined || presented.length === 0) return undefined;
  const row = findRefreshToken(db, hashRefreshToken(presented));
  if (row === undefined || row.revoked_at !== null) return undefined;
  if (row.expires_at <= now.toISOString()) return undefined;

  const user = findUserBySubject(db, row.subject);
  if (user === undefined) return undefined;

  // `listFamily` orders by issue time, so the first member is the sign-in.
  const born = listFamily(db, row.family_id)[0]?.issued_at ?? row.issued_at;
  return {
    subject: row.subject,
    familyId: row.family_id,
    user,
    authTime: Math.floor(Date.parse(born) / 1000),
  };
}

/**
 * The single role `ward_role` carries, or `undefined` for no grant.
 *
 * A subject can hold several roles in one app (the grants key is the whole
 * triple). The claim is one string because its one consumer, an app creating a
 * local user on a first Ward sign-in, gives that user one starting role; from
 * then on the app's own row is the truth (decisions-oidc.md, "the app owns the
 * role"). The first role in sort order is taken, so the answer is stable.
 */
export function wardRole(
  db: Database.Database,
  subject: string,
  clientId: string,
): string | undefined {
  return listRolesInApp(db, subject, clientId)[0];
}

/**
 * The provider's `findAccount`.
 *
 * Called in two places. During an authorization (`token` undefined) it only has
 * to say the account exists and is usable; the interaction checked the session
 * and the grant a moment earlier. When a code is exchanged (`token` is the code)
 * it is the **last check before an ID token is signed**, so it re-asks every
 * question the interaction asked, now: the account is not disabled, the Ward
 * family named by the authorization is still live and still this subject's,
 * and the grant still exists. A sign-out, a console revoke or a removed grant
 * inside the code's 60-second life therefore yields `invalid_grant`, not a
 * token.
 */
export function wardFindAccount(db: Database.Database): FindAccount {
  return async (
    _ctx: KoaContextWithOIDC,
    sub: string,
    token?: { grantId?: string },
  ): Promise<Account | undefined> => {
    const user = findUserBySubject(db, sub);
    if (user === undefined || user.disabled_at !== null) return undefined;

    if (token === undefined) {
      return { accountId: sub, claims: () => ({ sub }) };
    }

    const authorization =
      typeof token.grantId === "string"
        ? findAuthorization(db, token.grantId, epochNow())
        : undefined;
    if (authorization === undefined || authorization.subject !== sub) return undefined;
    if (!hasLiveFamily(db, authorization.family_id, sub)) return undefined;

    const roles = listRolesInApp(db, sub, authorization.client_id);
    if (roles.length === 0) return undefined;
    // The role the interaction saw, if it is still held; otherwise the current
    // first one, so a role swapped inside the minute is not reported stale.
    const role = roles.includes(authorization.role) ? authorization.role : roles[0]!;

    return {
      accountId: sub,
      claims: () => ({
        sub,
        preferred_username: user.username,
        ward_sid: authorization.family_id,
        ward_role: role,
      }),
    };
  };
}
