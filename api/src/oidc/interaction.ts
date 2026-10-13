import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Provider from "oidc-provider";
import { z } from "zod";

import { REFRESH_COOKIE_NAME, readCookie } from "../auth/cookie.js";
import { recordAudit } from "../db/audit-log.js";
import { getApp } from "../db/apps.js";
import { wardRole, wardSessionFor, type WardBrowserSession } from "./account.js";
import { epochNow } from "./adapter.js";
import { recordAuthorization } from "./authorizations.js";
import { INTERACTION_INTERNAL_PREFIX, loginUrlFor, type OidcLayout } from "./layout.js";
import { GRANT_TTL_SECONDS, ID_TOKEN_CLAIMS, plainPage } from "./provider.js";

/**
 * The provider's login step: `GET /refresh/oidc/:uid` and two helpers.
 *
 * The provider sends every authorization here (see the `ward_session` check in
 * `provider.ts`). This route is the whole of "who is this, and may they":
 *
 *  1. **Ward's refresh cookie decides who is signed in.** The route sits under
 *     `/refresh` because the cookie is scoped to `Path=/ward-api/refresh`; it
 *     reads the cookie and never rotates it. No live Ward session, and the
 *     person goes to Ward's own login page (`?oidc=<uid>`), which signs them in
 *     the ordinary way — `POST /login`, an ordinary refresh family — and sends
 *     the browser back here.
 *  2. **The account must be usable and hold a grant for the client's app.**
 *     Otherwise the app gets `access_denied` at its redirect URI, which is what
 *     it shows its own message for (decisions-oidc.md).
 *  3. **First-party clients never see a consent screen.** The route grants the
 *     `openid` scope itself and finishes the interaction in one step.
 *
 * Nothing here compares an `Origin` with Ward's, or sets a cookie the flow
 * needs at `Path=/`: the app may live on any origin, and the only cookies are
 * Ward's existing refresh cookie and the provider's own, path-scoped ones.
 */

/** nanoid's alphabet. Anything else is not an interaction id. */
const uidParams = z.object({ uid: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

interface InteractionRoutesOptions {
  /** The database and provider, built on first use (see `routes.ts`). */
  resolve: () => Promise<{ db: Database.Database; provider: Provider }>;
  layout: OidcLayout;
}

type Denial = "account_disabled" | "no_grant" | "cancelled";

const DENIAL_DESCRIPTIONS: Record<Denial, string> = {
  account_disabled: "the account is disabled",
  no_grant: "the account holds no grant for this app",
  cancelled: "the person cancelled the sign-in",
};

export async function interactionRoutes(
  app: FastifyInstance,
  { resolve, layout }: InteractionRoutesOptions,
): Promise<void> {
  /**
   * Load the interaction this browser is in the middle of, or answer with a
   * page saying it is over. The provider ties an interaction to the browser
   * with its own short cookie, so a uid alone, from a link or a log line, is
   * not enough to finish someone else's.
   */
  async function loadInteraction(provider: Provider, request: FastifyRequest, reply: FastifyReply) {
    reply.header("cache-control", "no-store");
    const params = uidParams.safeParse(request.params);
    if (!params.success) {
      await expired(reply);
      return undefined;
    }
    try {
      const details = await provider.interactionDetails(request.raw, reply.raw);
      if (details.uid !== params.data.uid) {
        await expired(reply);
        return undefined;
      }
      return details;
    } catch {
      await expired(reply);
      return undefined;
    }
  }

  async function deny(
    { db, provider }: { db: Database.Database; provider: Provider },
    request: FastifyRequest,
    reply: FastifyReply,
    clientId: string,
    reason: Denial,
    session?: WardBrowserSession,
  ) {
    recordAudit(db, {
      actorKind: session === undefined ? "system" : "account",
      actorSubject: session?.subject ?? null,
      actorLabel: session?.user.username ?? "ward",
      action: "oidc.denied",
      targetKind: "app",
      targetId: clientId,
      detail: { reason, ...(session === undefined ? {} : { family: session.familyId }) },
    });
    const returnTo = await provider.interactionResult(
      request.raw,
      reply.raw,
      { error: "access_denied", error_description: DENIAL_DESCRIPTIONS[reason] },
      { mergeWithLastSubmission: false },
    );
    return reply.redirect(returnTo, 303);
  }

  // No HEAD twins for the two routes that finish an interaction: Fastify would
  // run the same handler for HEAD, and finishing a sign-in is not something a
  // link checker should be able to do. `/verify` made the same call.
  app.get(
    `${INTERACTION_INTERNAL_PREFIX}/:uid`,
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { db, provider } = await resolve();
      const details = await loadInteraction(provider, request, reply);
      if (details === undefined) return reply;

      const clientId = String(details.params["client_id"]);
      const session = wardSessionFor(db, readCookie(request.headers.cookie, REFRESH_COOKIE_NAME));

      if (session === undefined || needsFreshSignIn(details, session)) {
        return reply.redirect(loginUrlFor(layout, details.uid), 303);
      }

      if (session.user.disabled_at !== null) {
        return deny({ db, provider }, request, reply, clientId, "account_disabled", session);
      }

      const role = wardRole(db, session.subject, clientId);
      if (role === undefined) {
        return deny({ db, provider }, request, reply, clientId, "no_grant", session);
      }

      // A fresh grant per authorization, holding `openid` and nothing else. The
      // interaction runs every time, so there is never an older grant to reuse,
      // and its id is the key `findAccount` finds the Ward session under.
      const grant = new provider.Grant({ accountId: session.subject, clientId });
      grant.addOIDCScope("openid");
      grant.addOIDCClaims([...ID_TOKEN_CLAIMS]);
      const grantId = await grant.save();

      recordAuthorization(db, {
        grantId,
        clientId,
        subject: session.subject,
        familyId: session.familyId,
        role,
        expiresAt: epochNow() + GRANT_TTL_SECONDS,
      });
      recordAudit(db, {
        actorKind: "account",
        actorSubject: session.subject,
        actorLabel: session.user.username,
        action: "oidc.authorize",
        targetKind: "session",
        targetId: session.familyId,
        detail: { client: clientId, role },
      });

      const returnTo = await provider.interactionResult(
        request.raw,
        reply.raw,
        {
          // `remember: false` makes the provider's own session cookie a
          // browser-session cookie: it holds a hand-off, not a sign-in.
          login: { accountId: session.subject, ts: session.authTime, remember: false },
          consent: { grantId },
        },
        { mergeWithLastSubmission: false },
      );
      return reply.redirect(returnTo, 303);
    },
  );

  /**
   * `GET /refresh/oidc/:uid/client` — which app the login page is signing
   * someone in to, so it can say "Continue to Atrium". The display name is not
   * a secret, and the interaction cookie is still required, so this names the
   * app only to the browser already in the flow.
   */
  app.get(`${INTERACTION_INTERNAL_PREFIX}/:uid/client`, async (request, reply) => {
    const { db, provider } = await resolve();
    const details = await loadInteraction(provider, request, reply);
    if (details === undefined) return reply;
    const clientId = String(details.params["client_id"]);
    const row = getApp(db, clientId);
    return reply.code(200).send({ clientId, name: row?.name ?? clientId });
  });

  /**
   * `GET /refresh/oidc/:uid/abort` — "Back to <app>" on the login page. The app
   * gets `access_denied`, the same answer as a refusal, so it has one error
   * path rather than a person stranded at Ward. It is also the way out for a
   * disabled account, whose sign-in at Ward can only end in "account turned off".
   */
  app.get(
    `${INTERACTION_INTERNAL_PREFIX}/:uid/abort`,
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { db, provider } = await resolve();
      const details = await loadInteraction(provider, request, reply);
      if (details === undefined) return reply;
      return deny(
        { db, provider },
        request,
        reply,
        String(details.params["client_id"]),
        "cancelled",
      );
    },
  );
}

/**
 * `prompt=login` and `max_age` ask for a password typed recently, not merely a
 * live session. The family's birth is the last time a password was typed, so a
 * family born before this interaction began does not satisfy `prompt=login`,
 * and one older than `max_age` does not satisfy that. Both compare whole
 * seconds, the provider's resolution for `iat` and `auth_time`, so a sign-in in
 * the same second the authorization began counts as fresh — the direction that
 * cannot loop someone back to the form they just submitted.
 */
function needsFreshSignIn(
  details: { iat?: number; params: Record<string, unknown> },
  session: WardBrowserSession,
): boolean {
  const prompts = String(details.params["prompt"] ?? "").split(" ");
  if (prompts.includes("login") && session.authTime < (details.iat ?? 0)) return true;
  const maxAge = Number(details.params["max_age"]);
  if (Number.isFinite(maxAge) && details.params["max_age"] !== undefined) {
    return epochNow() - session.authTime > maxAge;
  }
  return false;
}

async function expired(reply: FastifyReply): Promise<void> {
  await reply
    .code(400)
    .type("text/html; charset=utf-8")
    .send(
      plainPage(
        "This sign-in has expired",
        "<p>Go back to the app and choose “Sign in with Ward” again.</p>",
      ),
    );
}
