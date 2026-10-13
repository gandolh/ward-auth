import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { Accounts, AuthUser } from "../core/accounts.js";
import { clearedCookie, readCookie, serializeCookie } from "../core/cookie.js";
import { foldUsername } from "../core/identifiers.js";
import type { Lockout, LockoutTarget } from "../core/lockout.js";
import { MAX_PASSWORD_LENGTH, PasswordPolicyError } from "../core/password.js";
import { AlreadyLinkedError, WardSubjectTakenError, isWardAuthStore } from "../store/types.js";
import type { SessionRecord, WardAuthStore } from "../store/types.js";
import { signInErrorFor, type WardClient, type WardFlowSecrets } from "../ward/client.js";
import { WardConfigurationError, WardUnavailableError } from "../ward/errors.js";
import { NoLocalPasswordError, NotLinkedError, type WardIdentities } from "../ward/identities.js";
import { crossSite, sameOrigin, tooManyAttempts } from "./http.js";
import type { SessionValidator } from "./plugin.js";

/**
 * "Sign in with Ward", linking, and the 30-second check, as Fastify routes.
 *
 * Registered by the `wardAuth` plugin when its `ward` option is set; nothing
 * here is used on its own. The routes, under the plugin's `routePrefix`:
 *
 * | route | guard | what |
 * |---|---|---|
 * | `POST /ward/start` | public | sign-in: answers `{ url }` to send the browser to |
 * | `GET /ward/callback` | public | the redirect URI; ends in a `303` to an app page |
 * | `POST /ward/link` | session | link Ward from settings: `{ url }` |
 * | `POST /ward/reauthenticate` | session | a fresh Ward sign-in (`prompt=login`): `{ url }` |
 * | `POST /ward/unlink` | session | `{ signedOut }`; `409 no_local_password` / `not_linked` |
 * | `POST /ward/set-password` | session | `204`; `403 reauthentication_required` |
 * | `POST /ward/logout` | session | ends the session here: `{ url }` of Ward's end-session, or `null` |
 *
 * ## Why the starts are POSTs that answer a URL
 *
 * A link changes the account, so it must not be reachable by a cross-site
 * `GET`. A `POST` under the plugin's same-origin check is not, and answering
 * the URL (rather than redirecting a `fetch`) lets the hook show an error —
 * `ward_unavailable` — without the person leaving the page.
 *
 * ## The flow cookie
 *
 * `<cookieName>_ward`: `state`, `nonce`, the PKCE verifier, the mode, and for
 * a link the hash of the session that asked. `HttpOnly`, `SameSite=Lax` (it
 * must survive the top-level navigation back from Ward), `Path=` the callback
 * path so no other request carries it, ten minutes, and cleared by the
 * callback whatever the outcome. One flow at a time per browser: starting a
 * second overwrites the first, whose callback then fails as
 * `invalid_callback`.
 *
 * A link callback must arrive with **the same session** that started it.
 * Without that, an attacker could start a link on their own account and get
 * the victim's browser to finish it, linking the victim's Ward account to the
 * attacker's local user.
 *
 * ## Where the callback sends the browser
 *
 * - sign-in: `returnTo` (a same-origin path the start named) or
 *   `afterSignInPath`; on failure `loginPath?ward_error=<code>`;
 * - link: `settingsPath?ward=linked`, or `settingsPath?ward_error=<code>`;
 * - reauthenticate: `settingsPath?ward=reauthenticated`, or the error.
 *
 * The codes are stable and the React hooks expose them; the app writes the
 * words.
 */

/** The `ward` option of `wardAuth`. */
export interface WardSignInOptions {
  /** From `createWardClient(wardClientOptionsFromEnv())`. */
  client: WardClient;
  /**
   * The app's login page, as the browser sees it (e.g. `/myapp/login`). A
   * failed sign-in lands here with `?ward_error=<code>`.
   */
  loginPath: string;
  /**
   * The account settings page, as the browser sees it. Link and
   * reauthentication results land here with `?ward=` or `?ward_error=`.
   */
  settingsPath: string;
  /** Where a successful sign-in lands when the start named no `returnTo`. */
  afterSignInPath: string;
  /**
   * The role a user created by a first Ward sign-in starts with, from the
   * grant's role (`ward_role`). Identity by default. After creation the app's
   * row is the only truth; Ward's role is never written back.
   */
  roleFor?: (wardRole: string) => string;
  /** Defaults to `createWardIdentities({ accounts })`. */
  identities?: WardIdentities;
}

/** A user may set a first local password this long after a Ward sign-in. */
export const FRESH_SIGN_IN_SECONDS = 10 * 60;

/** The flow cookie's life: one Ward interaction's span. */
const FLOW_MAX_AGE_SECONDS = 10 * 60;

type FlowMode = "sign_in" | "link" | "reauthenticate";

interface Flow extends WardFlowSecrets {
  mode: FlowMode;
  /** The session that started a link or reauthentication. */
  sessionIdHash?: string;
  returnTo?: string;
  startedAt: number;
}

export interface WardRoutesContext {
  accounts: Accounts;
  identities: WardIdentities;
  ward: Required<
    Pick<WardSignInOptions, "client" | "loginPath" | "settingsPath" | "afterSignInPath">
  > &
    Pick<WardSignInOptions, "roleFor">;
  publicOrigin: string;
  cookieName: string;
  secure: boolean;
  now: () => number;
  lockout: Lockout;
  lockoutKey(request: FastifyRequest): string;
  /** A `Set-Cookie` value for a new or renewed session. */
  sessionCookie(token: string, expiresAt: number): string;
  /** The `Set-Cookie` value that clears the session cookie. */
  clearedSessionCookie(): string;
}

/** Check the `ward` option at boot. Every path is a browser path on the app's origin. */
export function validateWardOptions(
  ward: WardSignInOptions,
  cookiePath: string,
  routePrefix: string,
): void {
  for (const name of ["loginPath", "settingsPath", "afterSignInPath"] as const) {
    if (!isLocalPath(ward[name])) {
      throw new TypeError(
        `wardAuth: ward.${name} must be a path on the app's origin, like "/myapp/login"`,
      );
    }
  }
  const callback = new URL(ward.client.redirectUri).pathname;
  const expectedTail = `${routePrefix}/ward/callback`;
  const underCookiePath =
    callback === cookiePath ||
    callback.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
  if (!callback.endsWith(expectedTail) || !underCookiePath) {
    // The callback must reach this plugin's route, and the session cookie
    // must be sent to it (a link callback needs the session that started it).
    throw new TypeError(
      `wardAuth: WARD_OIDC_REDIRECT_URI's path is ${callback}; it must end in ${expectedTail} ` +
        `and sit under the cookie path ${cookiePath}, i.e. be the plugin's callback route ` +
        `as the browser reaches it through the app's API prefix.`,
    );
  }
}

/**
 * The 30-second check, as the guard's first session validator.
 *
 * Local sessions return at once and never call Ward. A Ward-originated one is
 * checked against `POST /session-status` through the client's 30-second
 * cache. **Fails closed**: Ward unreachable, a timeout or a malformed answer
 * refuses the request with `ward_unavailable` (the session row stays, so it
 * works again when Ward is back); a `401` refuses with `ward_misconfigured`
 * and logs which settings to check; a Ward session that has ended ends this
 * one too.
 *
 * `ward` is `undefined` when the app runs without Ward configured. Its
 * Ward-originated sessions are then refused as `ward_unavailable`: nothing can
 * vouch for them, and letting them through would turn "Ward is not
 * configured" into "revocation is off".
 */
export function wardSessionValidator(
  ward: { client: WardClient; identities: WardIdentities } | undefined,
): SessionValidator {
  return async (resolved, request) => {
    const { session, user } = resolved;
    if (session.origin !== "ward" || session.wardSid === null) return { ok: true };
    if (ward === undefined) return { ok: false, reason: "ward_unavailable" };

    const subject = await ward.identities.subjectOf(user.id);
    if (subject === undefined) {
      // Unlinked since: there is no Ward account left to vouch for it.
      return { ok: false, reason: "ward_session_ended", endSession: true };
    }

    try {
      const status = await ward.client.checkSession(session.wardSid, subject);
      return status.active
        ? { ok: true }
        : { ok: false, reason: "ward_session_ended", endSession: true };
    } catch (error) {
      if (error instanceof WardConfigurationError) {
        request.log.error({ err: error }, error.message);
        return { ok: false, reason: "ward_misconfigured" };
      }
      if (error instanceof WardUnavailableError) {
        request.log.warn({ err: error }, "Ward session check failed; refusing the session");
        return { ok: false, reason: "ward_unavailable" };
      }
      throw error;
    }
  };
}

/** What `/session` (and the sign-in answers) say about Ward. */
export async function wardStatusFor(
  identities: WardIdentities | undefined,
  user: AuthUser | null,
): Promise<{ enabled: boolean; linked: boolean }> {
  if (identities === undefined) return { enabled: false, linked: false };
  if (user === null) return { enabled: true, linked: false };
  return { enabled: true, linked: (await identities.subjectOf(user.id)) !== undefined };
}

export function registerWardRoutes(routes: FastifyInstance, context: WardRoutesContext): void {
  const { accounts, identities, ward, publicOrigin, now } = context;
  const client = ward.client;
  const store = accounts.store as WardAuthStore;
  if (!isWardAuthStore(store)) {
    throw new TypeError("wardAuth: the ward option needs a store with the Ward methods");
  }
  const flowCookieName = `${context.cookieName}_ward`;
  const flowCookiePath = new URL(client.redirectUri).pathname;

  function flowCookie(flow: Flow): string {
    return serializeCookie({
      name: flowCookieName,
      value: Buffer.from(JSON.stringify(flow), "utf8").toString("base64url"),
      path: flowCookiePath,
      maxAgeSeconds: FLOW_MAX_AGE_SECONDS,
      secure: context.secure,
    });
  }

  function readFlow(request: FastifyRequest): Flow | undefined {
    const raw = readCookie(request.headers.cookie, flowCookieName);
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const flow = parsed as Partial<Flow>;
    const strings = [flow.state, flow.nonce, flow.codeVerifier];
    if (!strings.every((value) => typeof value === "string" && value.length > 0)) return undefined;
    if (flow.mode !== "sign_in" && flow.mode !== "link" && flow.mode !== "reauthenticate") {
      return undefined;
    }
    if (typeof flow.startedAt !== "number") return undefined;
    // The cookie's Max-Age is the browser's promise; this is the server's.
    if (now() - flow.startedAt > FLOW_MAX_AGE_SECONDS * 1000) return undefined;
    if (flow.returnTo !== undefined && !isLocalPath(flow.returnTo)) return undefined;
    return flow as Flow;
  }

  /** Start a round trip: the flow cookie, and the URL for the browser. */
  async function start(
    reply: FastifyReply,
    mode: FlowMode,
    extra: { sessionIdHash?: string; returnTo?: string },
  ): Promise<FastifyReply> {
    let started: Awaited<ReturnType<WardClient["startAuthorization"]>>;
    try {
      started = await client.startAuthorization(
        mode === "reauthenticate" ? { prompt: "login" } : {},
      );
    } catch (error) {
      return wardDown(reply, error);
    }
    const flow: Flow = { ...started.flow, mode, startedAt: now(), ...extra };
    reply.header("set-cookie", flowCookie(flow));
    reply.header("cache-control", "no-store");
    return reply.code(200).send({ url: started.url });
  }

  function wardDown(reply: FastifyReply, error: unknown): FastifyReply {
    if (error instanceof WardConfigurationError) {
      reply.log.error({ err: error }, error.message);
      return reply.code(503).send({ error: "ward_misconfigured" });
    }
    if (error instanceof WardUnavailableError) {
      reply.log.warn({ err: error }, "Ward is unreachable");
      return reply.code(503).send({ error: "ward_unavailable" });
    }
    throw error;
  }

  /** A `303` to an app page, on the app's own origin. */
  function land(reply: FastifyReply, path: string, query: Record<string, string>): FastifyReply {
    const target = new URL(path, publicOrigin);
    for (const [name, value] of Object.entries(query)) target.searchParams.set(name, value);
    return (
      reply
        .code(303)
        .header("location", target.href)
        .header("cache-control", "no-store")
        // The callback URL carried an authorization code; do not hand it on.
        .header("referrer-policy", "no-referrer")
        .send()
    );
  }

  async function startSession(
    reply: FastifyReply,
    userId: string,
    wardSid: string,
    idToken: string,
  ): Promise<void> {
    const { token, session } = await accounts.startSession(userId, { origin: "ward", wardSid });
    await store.setSessionWardIdToken(session.idHash, idToken);
    reply.header("set-cookie", context.sessionCookie(token, session.expiresAt));
  }

  /** The live session the request's cookie names, without running the checks. */
  async function currentSession(
    request: FastifyRequest,
  ): Promise<{ token: string; user: AuthUser; session: SessionRecord } | undefined> {
    const token = readCookie(request.headers.cookie, context.cookieName);
    if (token === undefined) return undefined;
    const resolved = await accounts.resolveSession(token);
    return resolved === undefined ? undefined : { token, ...resolved };
  }

  // ---------------------------------------------------------------------------

  routes.post("/ward/start", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body !== "object" || body === null) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const returnTo = body["returnTo"];
    if (returnTo !== undefined && (typeof returnTo !== "string" || !isLocalPath(returnTo))) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return start(reply, "sign_in", returnTo === undefined ? {} : { returnTo });
  });

  routes.post("/ward/link", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const auth = request.auth;
    if (auth === null) return reply.code(401).send({ error: "unauthorized" });
    if ((await identities.subjectOf(auth.user.id)) !== undefined) {
      return reply.code(409).send({ error: "already_linked" });
    }
    return start(reply, "link", { sessionIdHash: auth.session.idHash });
  });

  routes.post("/ward/reauthenticate", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const auth = request.auth;
    if (auth === null) return reply.code(401).send({ error: "unauthorized" });
    if ((await identities.subjectOf(auth.user.id)) === undefined) {
      return reply.code(409).send({ error: "not_linked" });
    }
    return start(reply, "reauthenticate", { sessionIdHash: auth.session.idHash });
  });

  /**
   * The redirect URI. Public: on a sign-in there is no session yet. Every
   * outcome is a `303` to one of the app's pages, and the flow cookie is
   * cleared on all of them.
   */
  routes.get("/ward/callback", async (request, reply) => {
    reply.header("set-cookie", clearedCookie(flowCookieName, flowCookiePath, context.secure));
    const flow = readFlow(request);
    if (flow === undefined) return land(reply, ward.loginPath, { ward_error: "invalid_callback" });

    const errorPage = flow.mode === "sign_in" ? ward.loginPath : ward.settingsPath;
    const rawUrl = request.raw.url ?? "";
    const search = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";

    let identity;
    try {
      identity = await client.finishAuthorization(search, flow);
    } catch (error) {
      const failure = signInErrorFor(error);
      if (failure.code === "ward_misconfigured")
        request.log.error({ err: failure }, failure.message);
      else if (failure.code === "ward_unavailable" || failure.code === "ward_error") {
        request.log.warn({ err: failure }, failure.message);
      }
      return land(reply, errorPage, { ward_error: failure.code });
    }

    if (flow.mode === "sign_in") {
      const { user } = await identities.userForSignIn(identity, ward.roleFor);
      // Signing in on top of an old session replaces it, as a password sign-in does.
      const previous = readCookie(request.headers.cookie, context.cookieName);
      if (previous !== undefined) await accounts.endSession(previous);
      await accounts.deleteExpiredSessions();
      await startSession(reply, user.id, identity.wardSid, identity.idToken);
      return land(reply, flow.returnTo ?? ward.afterSignInPath, {});
    }

    // Link and reauthenticate finish only for the session that started them.
    const current = await currentSession(request);
    if (current === undefined || current.session.idHash !== flow.sessionIdHash) {
      return land(reply, ward.settingsPath, { ward_error: "unauthorized" });
    }

    if (flow.mode === "link") {
      try {
        await identities.link(current.user.id, identity.subject);
      } catch (error) {
        if (error instanceof AlreadyLinkedError || error instanceof WardSubjectTakenError) {
          return land(reply, ward.settingsPath, { ward_error: error.code });
        }
        throw error;
      }
      return land(reply, ward.settingsPath, { ward: "linked" });
    }

    // Reauthenticate: the same Ward account must come back, and the session
    // is replaced by a fresh Ward-originated one, which is what "set a local
    // password" checks for.
    if ((await identities.subjectOf(current.user.id)) !== identity.subject) {
      return land(reply, ward.settingsPath, { ward_error: "ward_account_mismatch" });
    }
    await accounts.endSession(current.token);
    await startSession(reply, current.user.id, identity.wardSid, identity.idToken);
    return land(reply, ward.settingsPath, { ward: "reauthenticated" });
  });

  /**
   * Unlink Ward. Refused while the user has no local password, which would
   * lock them out. Ends every Ward-originated session the user holds — this
   * one too, if it began with Ward — and says so: `{ signedOut: true }` means
   * the person must now sign in with their password.
   */
  routes.post("/ward/unlink", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const auth = request.auth;
    if (auth === null) return reply.code(401).send({ error: "unauthorized" });
    try {
      await identities.unlink(auth.user.id);
    } catch (error) {
      if (error instanceof NoLocalPasswordError || error instanceof NotLinkedError) {
        return reply.code(409).send({ error: error.code });
      }
      throw error;
    }
    const signedOut = auth.session.origin === "ward";
    if (signedOut) reply.header("set-cookie", context.clearedSessionCookie());
    return reply.code(200).send({ signedOut });
  });

  /**
   * Set a local password. A user who has one must give it (this is then a
   * password change). A user created from Ward has none, and must have signed
   * in with Ward within the last ten minutes — `POST /ward/reauthenticate`
   * gets them there — so a session left open on a shared machine cannot be
   * turned into a permanent password. Ends the user's other sessions.
   */
  routes.post("/ward/set-password", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const auth = request.auth;
    if (auth === null) return reply.code(401).send({ error: "unauthorized" });

    const address = context.lockoutKey(request);
    const gate = context.lockout.check({ surface: "change_password", address });
    if (!gate.allowed) return tooManyAttempts(reply, gate.retryAfterSeconds ?? 1);

    const body = setPasswordBody(request.body);
    if (body === undefined) return reply.code(400).send({ error: "invalid_request" });

    try {
      if (auth.user.hasPassword) {
        if (body.currentPassword === undefined) {
          return reply.code(400).send({ error: "invalid_request" });
        }
        const target: LockoutTarget = {
          surface: "change_password",
          address,
          account: foldUsername(auth.user.username),
        };
        const changed = await accounts.changePassword(
          auth.user.id,
          body.currentPassword,
          body.newPassword,
          auth.session.idHash,
        );
        if (!changed) {
          context.lockout.recordFailure(target);
          return reply.code(401).send({ error: "invalid_credentials" });
        }
        context.lockout.clearFailures(target);
        return reply.code(204).send();
      }

      const fresh =
        auth.session.origin === "ward" &&
        now() - auth.session.createdAt <= FRESH_SIGN_IN_SECONDS * 1000;
      if (!fresh) return reply.code(403).send({ error: "reauthentication_required" });
      await accounts.setPassword(auth.user.id, body.newPassword, auth.session.idHash);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PasswordPolicyError) return reply.code(400).send({ error: error.code });
      throw error;
    }
  });

  /**
   * "Sign out of Ward too": end this session, and answer the URL of Ward's
   * end-session endpoint with this session's ID token as the hint, which
   * makes Ward revoke the Ward session it began with. `{ url: null }` for a
   * session that did not begin with Ward: it is signed out here, and there is
   * nothing at Ward to name. When Ward's URL cannot be built (discovery
   * failing), nothing is ended and the answer is `503 ward_unavailable`.
   */
  routes.post("/ward/logout", async (request, reply) => {
    if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
    const auth = request.auth;
    if (auth === null) return reply.code(401).send({ error: "unauthorized" });

    const idToken =
      auth.session.origin === "ward"
        ? await store.findSessionWardIdToken(auth.session.idHash)
        : undefined;
    let url: string | null = null;
    if (idToken !== undefined) {
      try {
        url = await client.endSessionUrl(idToken);
      } catch (error) {
        return wardDown(reply, error);
      }
    }
    await accounts.endSessionByIdHash(auth.session.idHash);
    reply.header("set-cookie", context.clearedSessionCookie());
    reply.header("cache-control", "no-store");
    return reply.code(200).send({ url });
  });
}

function setPasswordBody(
  body: unknown,
): { newPassword: string; currentPassword?: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { newPassword, currentPassword } = body as Record<string, unknown>;
  if (typeof newPassword !== "string" || newPassword.length === 0) return undefined;
  if (currentPassword === undefined || currentPassword === null) return { newPassword };
  if (typeof currentPassword !== "string") return undefined;
  if (currentPassword.length === 0 || currentPassword.length > MAX_PASSWORD_LENGTH)
    return undefined;
  return { newPassword, currentPassword };
}

/**
 * A path on the app's own origin: starts with one `/`, no `//` or `/\`
 * (which browsers read as another host), no control characters, short.
 * What `returnTo` and the configured pages must be — never an open redirect.
 */
export function isLocalPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !value.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
