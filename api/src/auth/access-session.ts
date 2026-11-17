import type Database from "better-sqlite3";

import { resolveSession, type ActiveSession } from "../grants/resolve.js";
import { AccessTokenVerificationError } from "../tokens/verify.js";
import { verifyWardAccessToken } from "../tokens/service.js";
import { ACCESS_COOKIE_NAME, readCookie } from "./cookie.js";

/**
 * The live Ward session a request's `ward_session` cookie names, if any.
 *
 * Read by `GET /session` and the `/account` routes — the two readers of the
 * access cookie, both serving Ward's own pages.
 *
 * ## One cookie, or signed out
 *
 * Ward sets `ward_session` once, at one path, so it expects one value; with
 * more than one, the browser's order says nothing about which is Ward's. Such
 * a request is signed out here, whichever value would verify: `readCookie`
 * takes no value when there are several (`auth/cookie.ts`).
 *
 * ## What counts as "not signed in"
 *
 * Only `AccessTokenVerificationError`. Anything else — an unreadable signing
 * key, a `jose` fault — is Ward being broken and is rethrown, so it surfaces as
 * a `500` an operator sees rather than a silent sign-out.
 *
 * A **console token** (`wcs_` + random) fails verification here — it has one
 * dot-separated segment where a compact JWS has three — and that is the whole
 * mechanism by which the superuser has no account page: it has no account row,
 * and there must never be an `isSuperuser` branch in this path.
 */
export interface LiveAccessSession {
  /** The access token's `sub`. */
  subject: string;
  /** The access token's `sid`: the refresh family this session belongs to. */
  familyId: string;
  /** `resolveSession`'s answer, which is live by construction. */
  resolution: ActiveSession;
}

/** Debug-level logging only; a log line never carries a token. */
interface SessionLogger {
  debug(object: object, message: string): void;
}

export async function liveAccessSession(
  db: Database.Database,
  cookieHeader: string | string[] | undefined,
  log: SessionLogger,
): Promise<LiveAccessSession | undefined> {
  const token = readCookie(cookieHeader, ACCESS_COOKIE_NAME);
  if (token === undefined) return undefined;

  let subject: string;
  let familyId: string;
  try {
    // Takes the token and nothing else, so no caller can weaken the issuer,
    // audience, expiry or clock tolerance (see `tokens/service.ts`).
    const claims = await verifyWardAccessToken(token);
    subject = claims.sub;
    familyId = claims.sid;
  } catch (error) {
    if (!(error instanceof AccessTokenVerificationError)) throw error;
    log.debug({ err: error }, "access cookie did not verify");
    return undefined;
  }

  const resolution = resolveSession(db, subject, familyId);
  return resolution.active ? { subject, familyId, resolution } : undefined;
}
