import type { FastifyReply, FastifyRequest } from "fastify";

import { MAX_USERNAME_LENGTH } from "../core/identifiers.js";
import { MAX_PASSWORD_LENGTH } from "../core/password.js";
import type { SessionRecord } from "../store/types.js";

/**
 * Request and reply helpers shared by the plugin's routes and its Ward routes:
 * body shapes, the same-origin check, and the stock error replies.
 */

/** What the browser is told about its session. No ids, no hashes. */
export function publicSession(session: SessionRecord): {
  origin: SessionRecord["origin"];
  expiresAt: number;
} {
  return { origin: session.origin, expiresAt: session.expiresAt };
}

export function credentialsBody(body: unknown): { username: string; password: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") return undefined;
  // Trimmed: a trailing space in a username is invisible and never intended.
  const trimmed = username.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_USERNAME_LENGTH) return undefined;
  // NOT trimmed: a space is a legitimate password character. Capped so an
  // anonymous endpoint cannot be handed a multi-megabyte string.
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return undefined;
  return { username: trimmed, password };
}

export function passwordChangeBody(
  body: unknown,
): { currentPassword: string; newPassword: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { currentPassword, newPassword } = body as Record<string, unknown>;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") return undefined;
  if (currentPassword.length === 0 || currentPassword.length > MAX_PASSWORD_LENGTH)
    return undefined;
  // The new password's length rules are the policy's, answered with its codes.
  if (newPassword.length === 0) return undefined;
  return { currentPassword, newPassword };
}

/**
 * Whether the request is same-origin enough to act on the session cookie.
 *
 * **Absent headers pass**: a server-side caller or a script sends neither, and
 * refusing them would break every non-browser caller to defend against a
 * browser-only attack. What this catches is a browser that *did* send them and
 * said the request came from elsewhere. `Sec-Fetch-Site` must be exactly
 * `same-origin`; an unparseable `Origin` (including the literal `null`) is a
 * mismatch.
 */
export function sameOrigin(request: FastifyRequest, publicOrigin: string): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite.length > 0 && fetchSite !== "same-origin") {
    return false;
  }

  const origin = request.headers.origin;
  if (origin !== undefined && origin.length > 0) {
    try {
      if (new URL(origin).origin !== publicOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Decided on headers alone, before any credential is looked at. No cookie is touched. */
export function crossSite(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ error: "cross_site" });
}

/** `429` with `Retry-After`, and no artificial delay before it. */
export function tooManyAttempts(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header("retry-after", String(retryAfterSeconds))
    .send({ error: "too_many_attempts", retryAfterSeconds });
}
