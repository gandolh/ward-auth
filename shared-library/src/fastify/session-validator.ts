import type { FastifyRequest } from "fastify";

import type { ResolvedSession } from "../core/accounts.js";

// Its own module so the Fastify plugin and the Ward routes both take the type from here, rather than
// the Ward routes from the plugin that imports them.

/** A session check's answer. */
export type SessionVerdict =
  | { ok: true }
  | {
      ok: false;
      /** A stable code, sent to the browser as `reason` (e.g. `ward_unavailable`). */
      reason: string;
      /** Delete the session row and clear the cookie, rather than refusing only this request. */
      endSession?: boolean;
    };

/**
 * **The guard's extension hook.** Runs on every request that carries a live
 * session — guarded routes and `GET <routePrefix>/session` alike — after the
 * row is found and before the request proceeds. The Ward half hooks the 30-second
 * Ward check in here for Ward-originated sessions; a local session should
 * return `{ ok: true }` without doing any I/O.
 *
 * A validator that **throws** is treated as `{ ok: false, reason:
 * "session_check_failed" }`: failing closed is the rule.
 */
export type SessionValidator = (
  resolved: ResolvedSession,
  request: FastifyRequest,
) => SessionVerdict | Promise<SessionVerdict>;
