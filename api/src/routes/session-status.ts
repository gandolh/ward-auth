import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getDb } from "../db/connection.js";
import { findUserBySubject } from "../db/users.js";
import { hasLiveFamily } from "../grants/resolve.js";
import { CLIENT_ASSERTION_TYPE, verifyClientAssertion } from "../oidc/client-auth.js";
import { wardRole } from "../oidc/account.js";

/**
 * `POST /session-status`: an app that signed someone in through Ward asks
 * whether that Ward session is still live and the grant still held.
 *
 * This is what `/introspect` was to the cookie sign-in, for the OpenID Connect
 * one (`corpus/wiki/decisions-oidc.md`, "Ward-originated sessions still end
 * within 30 seconds"). The app keeps the ID token's `ward_sid` on its own
 * session row and asks at most every 30 seconds, so a sign-out at Ward, a
 * console revoke, a password change or a removed grant ends the app's session
 * within that window. It needs no Ward access token and no app key: the app
 * proves who it is with the same `private_key_jwt` assertion it uses at the
 * token endpoint.
 *
 * The path is Fastify-side. Caddy serves Ward under `handle_path /ward-api/*`,
 * so a caller posts to `/ward-api/session-status`.
 *
 * ## The contract
 *
 * The body is JSON:
 *
 *     { "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
 *       "client_assertion": "<jwt>", "wardSid": "...", "subject": "..." }
 *
 * The first two fields are the standard form for `private_key_jwt`, in the body
 * rather than a header, so the assertion never reaches a proxy's access log.
 * The assertion's `aud` is the issuer (`WARD_OIDC_ISSUER`). It is the same
 * assertion `client-auth.ts` checks for the token endpoint, and it spends the
 * same replay markers, so a fresh one is signed for every call.
 *
 * - `200 {"active":true,"role":"<role>"}`: the family is live, it is this
 *   subject's, the account is active, and the account holds a grant in the
 *   calling client's app. `role` is the same one `ward_role` carries.
 * - `200 {"active":false}` for **every** other answer, byte for byte: the
 *   family is revoked, lapsed or unknown, the account is disabled or gone, the
 *   subject is not the family's, there is no grant for the caller's app, or the
 *   body is malformed. It never says which, for the reason `/introspect` gave:
 *   a diagnosis is an oracle. Without this an app could ask whether any
 *   family in the estate is live, or whether a subject holds a grant elsewhere.
 * - `401 {"error":"invalid_client"}` for an assertion that is missing or does
 *   not verify. As with `/introspect`'s app key, this is the one exception to
 *   the single answer: a misconfigured client is not a dead session, and
 *   answering `active:false` would sign every one of that app's Ward-originated
 *   users out silently. The app treats it as a configuration error, not as
 *   "signed out". Absent, malformed, unknown, forged, expired, wrong-audience
 *   and replayed are one answer to a caller; the reason is on the log line.
 *
 * The app is always the assertion's client, never one named in the body, so an
 * app can ask only about grants it holds the authority over.
 *
 * ## Not configured is a 404
 *
 * Without `WARD_OIDC_ISSUER` this registers nothing, like the provider itself:
 * there is no issuer to name as the audience and no clients, so the route does
 * not exist and Fastify answers `404`. An app reads that as a configuration
 * error too (anything but `200` fails closed).
 *
 * ## The body is parsed leniently
 *
 * A body that is not JSON is read as no body at all, so it gets the same `401`
 * as any other call with no assertion rather than Fastify's `400`. An
 * authenticated caller with a bad `wardSid` gets `active:false`. There is no
 * second failure mode to branch on.
 *
 * ## Audited like `/introspect`: not at all
 *
 * No audit row. Every Ward-originated session of every app asks every 30
 * seconds, so an audit row per call is a write amplifier fed by ordinary
 * traffic that would bury the lines an operator needs. A revocation is audited
 * where it happens. A refused assertion is logged at `warn` with its reason and
 * the client it claimed, which is what an operator reads. The one write this
 * route causes is the replay marker, which the sweep removes after it expires.
 *
 * ## No rate limit
 *
 * The argument in `routes/introspect.ts` carries over unchanged: a limit on a
 * call every app makes for every session would be read as "not live" and sign
 * people out, which is worse than the abuse it prevents. The assertion check
 * runs before any other work, which is the bound: an anonymous caller costs one
 * signature check at most, and only for a client that exists.
 */

export interface SessionStatusRoutesOptions {
  /** For tests. Production resolves the process-wide handle lazily. */
  db?: Database.Database;
  /** For tests. Production reads `WARD_OIDC_ISSUER`. */
  issuer?: string;
}

/**
 * The body's own fields. Capped like `/introspect`'s token: a `wardSid` is 32
 * hex characters and a subject at most 64, so nothing larger is a real call.
 * Unknown keys are ignored rather than refused: the credential fields share
 * the object.
 */
const statusBody = z.object({
  wardSid: z.string().min(1).max(128),
  subject: z.string().min(1).max(64),
});

/** The assertion fields, read before and apart from the rest of the body. */
const credentialBody = z.object({
  client_assertion_type: z.string(),
  client_assertion: z.string(),
});

const STATUS_ROUTE_SCHEMA = {
  200: {
    type: "object",
    properties: { active: { type: "boolean" }, role: { type: "string" } },
    required: ["active"],
    additionalProperties: false,
  },
  401: {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
    additionalProperties: false,
  },
} as const;

/** The single negative answer, shared and frozen so no branch can add a reason. */
const INACTIVE = Object.freeze({ active: false });

/**
 * Whether `subject`'s Ward session `wardSid` is live and what the calling
 * client's app lets them be.
 *
 * Asks what `findAccount` asks when a code is exchanged: the account is not
 * disabled, the family is live and is this subject's (`hasLiveFamily` compares
 * the two), and `wardRole` finds a grant. One question, one answer, so a
 * session that could not be signed in now cannot be kept either.
 */
export function sessionStatusFor(
  db: Database.Database,
  clientId: string,
  wardSid: string,
  subject: string,
): { active: true; role: string } | { active: false } {
  const user = findUserBySubject(db, subject);
  if (user === undefined || user.disabled_at !== null) return INACTIVE;
  if (!hasLiveFamily(db, wardSid, subject)) return INACTIVE;

  const role = wardRole(db, subject, clientId);
  if (role === undefined) return INACTIVE;
  return { active: true, role };
}

export async function sessionStatusRoutes(
  app: FastifyInstance,
  options: SessionStatusRoutesOptions = {},
): Promise<void> {
  const issuer = options.issuer ?? (await import("../config.js")).OIDC?.issuer;
  if (issuer === undefined) {
    app.log.info("WARD_OIDC_ISSUER is unset; POST /session-status is not mounted");
    return;
  }

  const database = async (): Promise<Database.Database> => options.db ?? (await getDb());

  // A body that does not parse becomes no body; see the header.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, undefined);
    }
  });

  app.post(
    "/session-status",
    // A compact JWS is under 8 KiB (`client-auth.ts` refuses longer), and the
    // other two fields are short.
    { bodyLimit: 16 * 1024, schema: { response: STATUS_ROUTE_SCHEMA } },
    async (request, reply) => {
      // The answer is one app's view of one session; nothing may cache it.
      reply.header("cache-control", "no-store");

      const credentials = credentialBody.safeParse(request.body);
      const client = await verifyClientAssertion(
        await database(),
        credentials.success && credentials.data.client_assertion_type === CLIENT_ASSERTION_TYPE
          ? credentials.data.client_assertion
          : undefined,
        { audience: issuer },
      );
      if (!client.ok) {
        // `warn`: a refused client always means somebody has to fix a
        // deployment or look at who is knocking. Neither the assertion nor the
        // body is logged.
        request.log.warn(
          { reason: client.reason },
          "session-status: refusing a request with no usable client assertion",
        );
        return reply.code(401).send({ error: "invalid_client" });
      }

      const parsed = statusBody.safeParse(request.body);
      if (!parsed.success) {
        // Not echoed: zod's issues carry the submitted values.
        request.log.warn(
          { client: client.clientId },
          "session-status: body is not { wardSid, subject }",
        );
        return INACTIVE;
      }

      const answer = sessionStatusFor(
        await database(),
        client.clientId,
        parsed.data.wardSid,
        parsed.data.subject,
      );
      request.log.debug(
        { client: client.clientId, active: answer.active },
        "session-status: answered",
      );
      return answer;
    },
  );
}
