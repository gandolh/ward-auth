import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Provider from "oidc-provider";
import { z } from "zod";

import { REFRESH_COOKIE_NAME, readCookie } from "../auth/cookie.js";
import { recordRepeatedAudit } from "../audit.js";
import { recordAudit } from "../db/audit-log.js";
import { getApp } from "../db/apps.js";
import { wardRole, wardSessionFor, type WardBrowserSession } from "./account.js";
import { epochNow } from "./adapter.js";
import { recordAuthorization } from "./authorizations.js";
import { DENIAL_DESCRIPTIONS, type Denial } from "./denials.js";
import { INTERACTION_INTERNAL_PREFIX, chooserUrlFor, loginUrlFor, type OidcLayout } from "./layout.js";
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
 *     the browser back here. A request carrying more than one refresh cookie
 *     counts as no session on every route here (`readCookie`, `auth/cookie.ts`):
 *     the form, never the chooser, and nothing finishes.
 *  2. **A session from before this sign-in is offered, not used.** The login
 *     page asks "Continue as <name>" or "Use another account" (`&choose=1`),
 *     as Google's account chooser does, so signing out of an app and pressing
 *     "Sign in with Ward" again can end in a different account. Continue is
 *     `GET /refresh/oidc/:uid/continue`; another account is the ordinary form.
 *     A session born during this interaction was just chosen by typing a
 *     password, so it finishes without asking twice. `interactionMode` is the
 *     one place that decides.
 *  3. **The account must be usable and hold a grant for the client's app.**
 *     Otherwise the app gets `access_denied` at its redirect URI, which is what
 *     it shows its own message for (decisions-oidc.md).
 *  4. **First-party clients never see a consent screen.** The route grants the
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
    // Parsed by hand, not by a route schema: a bad uid renders the "expired" page.
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
    const event = {
      actorKind: session === undefined ? ("system" as const) : ("account" as const),
      actorSubject: session?.subject ?? null,
      actorLabel: session?.user.username ?? "ward",
      action: "oidc.denied",
      targetKind: "app" as const,
      targetId: clientId,
      detail: { reason, ...(session === undefined ? {} : { family: session.familyId }) },
    };
    // A cancel with no Ward session names nobody: a row per window, the rest
    // counted (`audit.ts`). Every denial that names an account writes its row.
    if (session === undefined && reason === "cancelled") recordRepeatedAudit(db, "oidc.cancelled", event);
    else recordAudit(db, event);
    const returnTo = await provider.interactionResult(
      request.raw,
      reply.raw,
      { error: "access_denied", error_description: DENIAL_DESCRIPTIONS[reason] },
      { mergeWithLastSubmission: false },
    );
    return reply.redirect(returnTo, 303);
  }

  /**
   * `GET /refresh/oidc/:uid` (`chose` false), where the provider and the login
   * form send the browser, and `GET /refresh/oidc/:uid/continue` (`chose`
   * true), the chooser's "Continue as <name>". Continue only skips the
   * chooser: an interaction that needs the password still gets the form.
   */
  async function resume(request: FastifyRequest, reply: FastifyReply, chose: boolean) {
    const { db, provider } = await resolve();
    const details = await loadInteraction(provider, request, reply);
    if (details === undefined) return reply;

    const clientId = String(details.params["client_id"]);
    const session = wardSessionFor(db, readCookie(request.headers.cookie, REFRESH_COOKIE_NAME));

    const mode = interactionMode(details, session, chose);
    // `session === undefined` is always `form`; restated so the type narrows.
    if (session === undefined || mode === "form") return reply.redirect(loginUrlFor(layout, details.uid), 303);
    if (mode === "choose") return reply.redirect(chooserUrlFor(layout, details.uid), 303);

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
  }

  // No HEAD twins for the routes that finish an interaction: Fastify would
  // run the same handler for HEAD, and finishing a sign-in is not something a
  // link checker should be able to do. `/verify` made the same call.
  app.get(`${INTERACTION_INTERNAL_PREFIX}/:uid`, { exposeHeadRoute: false }, (request, reply) =>
    resume(request, reply, false),
  );
  app.get(`${INTERACTION_INTERNAL_PREFIX}/:uid/continue`, { exposeHeadRoute: false }, (request, reply) =>
    resume(request, reply, true),
  );

  /**
   * `GET /refresh/oidc/:uid/client` — which app the login page is signing
   * someone in to, so it can say "Continue to Atrium", and, when the page is
   * the chooser, whose session it offers (`account`, otherwise `null`). Neither
   * is a secret from this browser: the interaction cookie is still required,
   * so this answers only the browser already in the flow, about its own
   * session.
   */
  app.get(`${INTERACTION_INTERNAL_PREFIX}/:uid/client`, async (request, reply) => {
    const { db, provider } = await resolve();
    const details = await loadInteraction(provider, request, reply);
    if (details === undefined) return reply;
    const clientId = String(details.params["client_id"]);
    const row = getApp(db, clientId);
    const session = wardSessionFor(db, readCookie(request.headers.cookie, REFRESH_COOKIE_NAME));
    const account =
      session !== undefined && interactionMode(details, session, false) === "choose" ? session.user.username : null;
    return reply.code(200).send({ clientId, name: row?.name ?? clientId, account });
  });

  /**
   * `GET /refresh/oidc/:uid/abort` — "Back to <app>" on the login page. The app
   * gets `access_denied`, the same answer as a refusal, so it has one error
   * path rather than a person stranded at Ward; the description says it was a
   * cancel, which the shared library turns into its own `cancelled` code. It is also the way out for a
   * disabled account, whose sign-in at Ward can only end in "account turned off".
   *
   * The row it writes names the Ward session's account when the browser has
   * one, as the chooser's "Back to <app>" does. With none, it is a row per
   * window and a count in between.
   */
  app.get(`${INTERACTION_INTERNAL_PREFIX}/:uid/abort`, { exposeHeadRoute: false }, async (request, reply) => {
    const { db, provider } = await resolve();
    const details = await loadInteraction(provider, request, reply);
    if (details === undefined) return reply;
    const session = wardSessionFor(db, readCookie(request.headers.cookie, REFRESH_COOKIE_NAME));
    return deny({ db, provider }, request, reply, String(details.params["client_id"]), "cancelled", session);
  });
}

/**
 * What an interaction gets from this browser's Ward session:
 *
 *  - `form`: no session, or one too old for `prompt=login` / `max_age`.
 *  - `finish`: the person chose it, on the chooser (`chose`) or by typing a
 *    password during this interaction (the family was born no earlier than the
 *    interaction, in the provider's whole seconds).
 *  - `choose`: a session from before this sign-in, offered on the chooser.
 */
export function interactionMode(
  details: { iat?: number; params: Record<string, unknown> },
  session: WardBrowserSession | undefined,
  chose: boolean,
): "form" | "finish" | "choose" {
  if (session === undefined || needsFreshSignIn(details, session)) return "form";
  if (chose) return "finish";
  return details.iat !== undefined && session.authTime >= details.iat ? "finish" : "choose";
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
    .send(plainPage("This sign-in has expired", "<p>Go back to the app and choose “Sign in with Ward” again.</p>"));
}
