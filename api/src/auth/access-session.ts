import type Database from "better-sqlite3";

import { resolveSession, type ActiveSession } from "../grants/resolve.js";
import { AccessTokenVerificationError } from "../tokens/verify.js";
import { verifyWardAccessToken } from "../tokens/service.js";
import { ACCESS_COOKIE_NAME, readCookies } from "./cookie.js";

/**
 * The live Ward session a request's `ward_session` cookie names, if any.
 *
 * Read by `GET /session` and the `/account` routes — the two readers of the
 * access cookie, both serving Ward's own pages.
 *
 * ## Why every value is tried
 *
 * The access cookie moved from `Path=/` to `Path=/ward-api` when the
 * shared-cookie contract was retired (`auth/cookie.ts`). A browser that signed
 * in before then holds both, sends both to `/ward-api/...`, and the order is the
 * browser's choice. The old one may be expired, or signed for a family that has
 * since been revoked, while the new one is fine — or the other way round.
 * Taking the first value would sign a person out, or keep them signed in, by
 * accident of ordering. So each value is verified and resolved in turn and the
 * **first live session** wins; a value that is merely well-signed is not
 * enough, because a signature outlives a revocation by up to 15 minutes.
 *
 * Both candidates are Ward-minted tokens for this browser, so picking either
 * live one is safe; the duplicate disappears the next time Ward sets or clears
 * the session, which expires the `Path=/` variant.
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
  for (const token of readCookies(cookieHeader, ACCESS_COOKIE_NAME)) {
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
      continue;
    }

    const resolution = resolveSession(db, subject, familyId);
    if (resolution.active) return { subject, familyId, resolution };
  }

  return undefined;
}
