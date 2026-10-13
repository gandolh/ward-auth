import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { liveAccessSession } from "../auth/access-session.js";
import { getDb } from "../db/connection.js";
import { INACTIVE, type SessionResolution } from "../grants/resolve.js";

/**
 * `GET /session` — "who am I", for a browser holding Ward's own cookie.
 *
 * Ward's sign-in and account pages call this (`ui/src/lib/session.ts`). The
 * token comes from the `ward_session` cookie and from nowhere else: there is no
 * body, no query parameter and no header form, so this route cannot be used to
 * ask about a token the caller obtained some other way — presenting a stolen
 * token here requires already being able to set it as a cookie on this origin,
 * at which point the session is simply being used.
 *
 * Apps never call this. They sign people in through OpenID Connect and ask
 * whether a Ward session is still live with `POST /session-status`
 * (`routes/session-status.ts`). Until 2026-10-13 apps also asked about Ward's
 * cookie through a server-to-server endpoint with the same answer shape; that
 * contract is retired (brief 30).
 *
 * ## One answer for every dead session, always `200`
 *
 * No cookie, a forged or expired or foreign-signed token, a console token, an
 * unknown subject, a disabled account, a revoked family — all resolve to the
 * same `200 {"active":false}`, byte for byte. It never says why, and
 * `ui/src/lib/session.ts`'s "ask, refresh once, ask again" dance depends on a
 * dead session being a `200` rather than a `401`.
 *
 * `500` remains possible and is deliberately not swallowed: an unreadable
 * signing key is Ward being broken, not the session being dead
 * (`auth/access-session.ts`).
 *
 * `GET`, and nothing sensitive goes in the URL — `app.ts` records that Fastify
 * logs query strings. The credential is the cookie, which is never logged.
 */

/**
 * The response shape, as a Fastify serialisation schema.
 *
 * This is not validation, it is a **filter**: `fast-json-stringify` emits only
 * the properties named below, so a future change that returned a whole
 * `UserRow` from `resolveSession` — with `password_hash` and `email` on it —
 * would serialise to exactly these four fields anyway. The comments in
 * `grants/resolve.ts` justify each one; this is the enforcement.
 *
 * `subject`, `username` and `grants` are absent from an inactive answer and are
 * therefore not `required`. Exported so a test can push a deliberately
 * over-full object through the real schema and prove the filter.
 */
export const SESSION_RESPONSE_SCHEMA = {
  200: {
    type: "object",
    properties: {
      active: { type: "boolean" },
      subject: { type: "string" },
      username: { type: "string" },
      grants: {
        type: "object",
        // App slugs are data, so the keys cannot be enumerated in a schema. The
        // value shape can be, and is: a set of opaque role strings.
        additionalProperties: { type: "array", items: { type: "string" } },
      },
    },
    required: ["active"],
    additionalProperties: false,
  },
} as const;

export interface SessionRoutesOptions {
  db?: Database.Database;
}

export async function sessionRoutes(
  app: FastifyInstance,
  options: SessionRoutesOptions = {},
): Promise<void> {
  const database = async (): Promise<Database.Database> => options.db ?? (await getDb());

  app.get(
    "/session",
    { schema: { response: SESSION_RESPONSE_SCHEMA } },
    async (request, reply): Promise<SessionResolution> => {
      /**
       * `no-store`: a per-session authorisation answer sitting in any shared
       * cache is one person's grants served to the next caller.
       */
      reply.header("cache-control", "no-store");

      const live = await liveAccessSession(await database(), request.headers.cookie, request.log);
      return live?.resolution ?? INACTIVE;
    },
  );
}
