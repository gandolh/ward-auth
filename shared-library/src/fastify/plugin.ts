import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";

import type { Accounts, AuthUser, ResolvedSession } from "../core/accounts.js";
import {
  clearedCookie,
  isValidCookieName,
  isValidCookiePath,
  readCookie,
  secureCookiesFor,
  serializeCookie,
} from "../core/cookie.js";
import { MAX_USERNAME_LENGTH, UsernamePolicyError, foldUsername } from "../core/identifiers.js";
import { createLockout, lockoutKeyFor, type Lockout, type LockoutTarget } from "../core/lockout.js";
import { MAX_PASSWORD_LENGTH, PasswordPolicyError } from "../core/password.js";
import { UsernameTakenError, type SessionRecord } from "../store/types.js";

/**
 * The Fastify plugin: the auth routes, and the app-wide guard.
 *
 * ```ts
 * await app.register(wardAuth, {
 *   accounts,                         // createAccounts({ store })
 *   cookieName: "atrium_session",
 *   cookiePath: "/atrium/api",        // the browser-visible API prefix
 *   publicOrigin: "https://example.com",
 *   routePrefix: "/auth",             // Fastify-side; routes are /auth/login …
 *   publicRoutes: ["GET /health"],
 * });
 * // …then every other route. Each one now has `request.auth`.
 * ```
 *
 * ## One guard, registered first, and no route authenticates itself
 *
 * Atrium's rule: an `onRequest` hook on the root instance, so a handler that
 * exists at all has an authenticated caller, and the failure mode of per-route
 * auth — the one route somebody forgot — cannot happen. The plugin escapes
 * Fastify's encapsulation (the same `skip-override` marker `fastify-plugin`
 * sets, without the dependency) so the hook lands on the instance it was
 * registered on. **Register it before any route or plugin of the app's own**:
 * Fastify copies hooks into a child context when the child is created, so a
 * plugin registered earlier would not inherit the guard.
 *
 * Because it escapes encapsulation, a `prefix` passed to `register` is ignored.
 * Use `routePrefix` for where the auth routes live.
 *
 * ## Responses
 *
 * Every error body is `{ error: <code> }`, and the codes are stable — the React
 * hooks expose them and each app writes its own message:
 *
 * | status | `error` | when |
 * |---|---|---|
 * | 400 | `invalid_request` | the body is not the expected shape |
 * | 400 | `invalid_username`, `password_too_short`, `password_too_long` | registration or a new password fails the policy |
 * | 401 | `unauthorized` (+ `reason` when a session check rejected it) | the guard found no live session |
 * | 401 | `invalid_credentials` | wrong username or password, or wrong current password |
 * | 403 | `cross_site` | a browser said the request came from another origin |
 * | 409 | `username_taken` | registration |
 * | 429 | `too_many_attempts` (+ `retryAfterSeconds`, and `Retry-After`) | lockout |
 *
 * ## Nothing sensitive travels in a URL
 *
 * Fastify's default request log line includes the URL, so credentials live in
 * the body on every route and there is no `GET` variant of any of them.
 */

/** What the guard attaches to `request.auth` on an authenticated request. */
export interface AuthContext {
  user: AuthUser;
  session: SessionRecord;
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The signed-in user and their session. Set by the guard on every route it
     * guards; `null` on an allowlisted route, which has no caller.
     */
    auth: AuthContext | null;
  }
}

/** A session check's answer. */
export type SessionVerdict =
  | { ok: true }
  | {
      ok: false;
      /** A stable code, sent to the browser as `reason` (brief 21: `ward_unavailable`). */
      reason: string;
      /** Delete the session row and clear the cookie, rather than refusing only this request. */
      endSession?: boolean;
    };

/**
 * **The guard's extension hook.** Runs on every request that carries a live
 * session — guarded routes and `GET <routePrefix>/session` alike — after the
 * row is found and before the request proceeds. Brief 21 hooks the 30-second
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

export interface WardAuthOptions {
  /** From `createAccounts({ store })`. */
  accounts: Accounts;
  /** `<app>_session`. Unique per app, because the estate shares one origin. */
  cookieName: string;
  /**
   * The cookie's `Path`: the app's API prefix **as the browser sees it**,
   * e.g. `/atrium/api`. Every request that needs the session must live under
   * it — WebSocket upgrades and `<img>` sources included.
   */
  cookiePath: string;
  /**
   * The app's public origin, e.g. `https://example.com`. Decides `Secure`
   * (off only for plain HTTP on loopback) and is what a browser's `Origin`
   * header must match on the plugin's `POST` routes.
   */
  publicOrigin: string;
  /** Where the auth routes are mounted, Fastify-side. Default `/auth`. */
  routePrefix?: string;
  /**
   * Turns on `POST <routePrefix>/register`, creating users with this role.
   * Off by default: most apps create their users with the seed helper.
   */
  registration?: { role: string };
  /**
   * Routes reachable with no session, as `"METHOD /pattern"` or `"/pattern"`
   * (any method), matched against the **route pattern** Fastify resolved —
   * never the raw URL, so a query string or an encoding cannot reach a handler
   * the pattern would not. `GET` entries also cover `HEAD`. The plugin's own
   * public routes and every `OPTIONS` preflight are added automatically.
   */
  publicRoutes?: readonly string[];
  /** For anything `publicRoutes` cannot say, such as a static-file wildcard. */
  isPublic?: (request: FastifyRequest) => boolean;
  /** Session checks, run in order. See `SessionValidator`. */
  validateSession?: SessionValidator | readonly SessionValidator[];
  /** Shared counter, if the app wants one across plugins. A fresh one otherwise. */
  lockout?: Lockout;
  /** Epoch milliseconds, for cookie `Max-Age`. Must match the one `accounts` uses. */
  now?: () => number;
}

/** The result of looking at a request's cookie. */
type Authentication =
  { kind: "none" } | { kind: "rejected"; reason?: string } | { kind: "ok"; context: AuthContext };

const wardAuthPlugin: FastifyPluginAsync<WardAuthOptions> = async (app, options) => {
  const { accounts } = options;
  const now = options.now ?? (() => Date.now());
  const routePrefix = normaliseRoutePrefix(options.routePrefix ?? "/auth");
  const lockout = options.lockout ?? createLockout({ now });
  const validators =
    options.validateSession === undefined
      ? []
      : Array.isArray(options.validateSession)
        ? [...(options.validateSession as readonly SessionValidator[])]
        : [options.validateSession as SessionValidator];

  if (!isValidCookieName(options.cookieName)) {
    throw new TypeError(
      `wardAuth: cookieName ${JSON.stringify(options.cookieName)} is not a valid cookie name`,
    );
  }
  if (!isValidCookiePath(options.cookiePath)) {
    throw new TypeError(
      `wardAuth: cookiePath ${JSON.stringify(options.cookiePath)} must be an absolute path`,
    );
  }
  const publicOrigin = parseOrigin(options.publicOrigin);
  const secure = secureCookiesFor(publicOrigin);
  const { cookieName, cookiePath } = options;

  const publicRoutes = new Set<string>();
  for (const entry of options.publicRoutes ?? []) publicRoutes.add(normalisePublicRoute(entry));
  for (const path of [
    "/login",
    "/logout",
    "/session",
    ...(options.registration ? ["/register"] : []),
  ]) {
    publicRoutes.add(`* ${routePrefix}${path}`);
  }

  function isPublic(request: FastifyRequest): boolean {
    if (request.method === "OPTIONS") return true;
    const pattern = request.routeOptions.url;
    if (pattern !== undefined) {
      const method = request.method === "HEAD" ? "GET" : request.method;
      if (publicRoutes.has(`* ${pattern}`) || publicRoutes.has(`${method} ${pattern}`)) return true;
    }
    return options.isPublic?.(request) ?? false;
  }

  function sessionCookie(token: string, expiresAt: number): string {
    return serializeCookie({
      name: cookieName,
      value: token,
      path: cookiePath,
      maxAgeSeconds: Math.ceil((expiresAt - now()) / 1000),
      secure,
    });
  }

  function clearCookie(reply: FastifyReply): void {
    reply.header("set-cookie", clearedCookie(cookieName, cookiePath, secure));
  }

  function lockoutKey(request: FastifyRequest): string {
    return lockoutKeyFor(request.socket.remoteAddress, request.headers["x-forwarded-for"], {
      warn: (detail, message) => request.log.warn(detail, message),
    });
  }

  /**
   * Resolve the request's cookie to a live session, run the session checks,
   * and re-send the cookie when the sliding expiry moved. Clears a cookie that
   * names nothing, so a browser stops presenting a dead token.
   */
  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Authentication> {
    const token = readCookie(request.headers.cookie, cookieName);
    if (token === undefined) return { kind: "none" };

    const resolved = await accounts.resolveSession(token);
    if (resolved === undefined) {
      clearCookie(reply);
      return { kind: "rejected" };
    }

    for (const validate of validators) {
      let verdict: SessionVerdict;
      try {
        verdict = await validate(resolved, request);
      } catch (error) {
        request.log.error({ err: error }, "session check threw; failing closed");
        verdict = { ok: false, reason: "session_check_failed" };
      }
      if (!verdict.ok) {
        if (verdict.endSession === true) {
          await accounts.endSessionByIdHash(resolved.session.idHash);
          clearCookie(reply);
        }
        return { kind: "rejected", reason: verdict.reason };
      }
    }

    if (resolved.renewed) {
      reply.header("set-cookie", sessionCookie(token, resolved.session.expiresAt));
    }
    return { kind: "ok", context: { user: resolved.user, session: resolved.session } };
  }

  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request, reply) => {
    if (isPublic(request)) return;

    const result = await authenticate(request, reply);
    if (result.kind !== "ok") {
      return reply
        .code(401)
        .send(
          result.kind === "rejected" && result.reason !== undefined
            ? { error: "unauthorized", reason: result.reason }
            : { error: "unauthorized" },
        );
    }
    request.auth = result.context;
  });

  await app.register(
    async (routes: FastifyInstance) => {
      routes.post("/login", async (request, reply) => {
        if (!sameOrigin(request, publicOrigin)) return crossSite(reply);

        const address = lockoutKey(request);
        const gate = lockout.check({ surface: "login", address });
        if (!gate.allowed) return tooManyAttempts(reply, gate.retryAfterSeconds ?? 1);

        const body = credentialsBody(request.body);
        if (body === undefined) {
          // Not a lockout failure: a malformed body is a client bug, not a
          // guess. And terse: echoing the fields back would echo the password.
          return reply.code(400).send({ error: "invalid_request" });
        }

        // Folded from the *submitted* name, so a guess at an account that does
        // not exist still gets its own bucket, which an attacker's success on
        // their own account must not forgive.
        const target: LockoutTarget = {
          surface: "login",
          address,
          account: foldUsername(body.username),
        };
        const user = await accounts.verifyCredentials(body.username, body.password);
        if (user === undefined) {
          lockout.recordFailure(target);
          // One answer for "no such user" and "wrong password".
          return reply.code(401).send({ error: "invalid_credentials" });
        }
        lockout.clearFailures(target);

        // Signing in on top of an old session replaces it rather than leaving
        // a second live row behind.
        const previous = readCookie(request.headers.cookie, cookieName);
        if (previous !== undefined) await accounts.endSession(previous);
        await accounts.deleteExpiredSessions();

        const { token, session } = await accounts.startSession(user.id);
        reply.header("set-cookie", sessionCookie(token, session.expiresAt));
        return reply.code(200).send({ user, session: publicSession(session) });
      });

      /**
       * Answers `204` whatever was presented. The cookie is cleared **only when
       * one was presented**: a cross-site page that could make the browser
       * clear it would sign the person out in a loop (Ward's finding), and the
       * same-origin check closes the rest.
       */
      routes.post("/logout", async (request, reply) => {
        if (!sameOrigin(request, publicOrigin)) return crossSite(reply);

        const token = readCookie(request.headers.cookie, cookieName);
        if (token !== undefined) {
          await accounts.endSession(token);
          clearCookie(reply);
        }
        return reply.code(204).send();
      });

      /**
       * "Who am I". Public, so a signed-out browser gets `200 { user: null }`
       * rather than an error to handle — the React hooks rely on that. `reason`
       * is present when a cookie named a session that a check rejected.
       */
      routes.get("/session", async (request, reply) => {
        const result = await authenticate(request, reply);
        if (result.kind === "ok") {
          return { user: result.context.user, session: publicSession(result.context.session) };
        }
        return result.kind === "rejected" && result.reason !== undefined
          ? { user: null, session: null, reason: result.reason }
          : { user: null, session: null };
      });

      /**
       * Change one's own password. Guarded, so `request.auth` is set. Ends every
       * other session the user holds; the one making the change stays.
       */
      routes.post("/password", async (request, reply) => {
        if (!sameOrigin(request, publicOrigin)) return crossSite(reply);
        const auth = request.auth;
        if (auth === null) return reply.code(401).send({ error: "unauthorized" });

        const address = lockoutKey(request);
        const gate = lockout.check({ surface: "change_password", address });
        if (!gate.allowed) return tooManyAttempts(reply, gate.retryAfterSeconds ?? 1);

        const body = passwordChangeBody(request.body);
        if (body === undefined) return reply.code(400).send({ error: "invalid_request" });

        const target: LockoutTarget = {
          surface: "change_password",
          address,
          account: foldUsername(auth.user.username),
        };

        let changed: boolean;
        try {
          changed = await accounts.changePassword(
            auth.user.id,
            body.currentPassword,
            body.newPassword,
            auth.session.idHash,
          );
        } catch (error) {
          if (error instanceof PasswordPolicyError)
            return reply.code(400).send({ error: error.code });
          throw error;
        }

        if (!changed) {
          lockout.recordFailure(target);
          return reply.code(401).send({ error: "invalid_credentials" });
        }
        lockout.clearFailures(target);
        return reply.code(204).send();
      });

      if (options.registration !== undefined) {
        const { role } = options.registration;

        /**
         * Create a local account and sign it in. **Every** attempt that parses
         * counts against the address's register budget, successes included: it
         * is the app's only anonymous write, so five accounts per address per
         * window is the ceiling, and a taken-name probe costs the same hash as a
         * real registration (the password is hashed before the uniqueness
         * check) so it is no cheaper an oracle.
         */
        routes.post("/register", async (request, reply) => {
          if (!sameOrigin(request, publicOrigin)) return crossSite(reply);

          const address = lockoutKey(request);
          const gate = lockout.check({ surface: "register", address });
          if (!gate.allowed) return tooManyAttempts(reply, gate.retryAfterSeconds ?? 1);

          const body = credentialsBody(request.body);
          if (body === undefined) return reply.code(400).send({ error: "invalid_request" });

          lockout.recordFailure({ surface: "register", address });

          let user: AuthUser;
          try {
            user = await accounts.createUser({
              username: body.username,
              password: body.password,
              role,
            });
          } catch (error) {
            if (error instanceof UsernamePolicyError || error instanceof PasswordPolicyError) {
              return reply.code(400).send({ error: error.code });
            }
            if (error instanceof UsernameTakenError) {
              return reply.code(409).send({ error: "username_taken" });
            }
            throw error;
          }

          const { token, session } = await accounts.startSession(user.id);
          reply.header("set-cookie", sessionCookie(token, session.expiresAt));
          return reply.code(201).send({ user, session: publicSession(session) });
        });
      }
    },
    { prefix: routePrefix },
  );
};

/**
 * Escape encapsulation, exactly as `fastify-plugin` does, so the guard lands on
 * the instance the app registered this on.
 */
Object.assign(wardAuthPlugin, {
  [Symbol.for("skip-override")]: true,
  [Symbol.for("fastify.display-name")]: "ward-auth",
});

export const wardAuth: FastifyPluginAsync<WardAuthOptions> = wardAuthPlugin;

/**
 * A `preHandler` that lets through only the given roles. The guard has already
 * established *who*; this says *what*. `403 { error: "forbidden" }` otherwise.
 *
 * ```ts
 * app.delete("/items/:id", { preHandler: requireRole("admin") }, handler);
 * ```
 */
export function requireRole(...roles: string[]): preHandlerAsyncHookHandler {
  return async function requireRoleHandler(request: FastifyRequest, reply: FastifyReply) {
    if (request.auth === null || !roles.includes(request.auth.user.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}

/** What the browser is told about its session. No ids, no hashes. */
function publicSession(session: SessionRecord): {
  origin: SessionRecord["origin"];
  expiresAt: number;
} {
  return { origin: session.origin, expiresAt: session.expiresAt };
}

function credentialsBody(body: unknown): { username: string; password: string } | undefined {
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

function passwordChangeBody(
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
function sameOrigin(request: FastifyRequest, publicOrigin: string): boolean {
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
function crossSite(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ error: "cross_site" });
}

/** `429` with `Retry-After`, and no artificial delay before it. */
function tooManyAttempts(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header("retry-after", String(retryAfterSeconds))
    .send({ error: "too_many_attempts", retryAfterSeconds });
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`wardAuth: publicOrigin ${JSON.stringify(value)} is not a URL`);
  }
  if (url.origin === "null" || url.origin !== value.replace(/\/$/, "")) {
    throw new TypeError(
      `wardAuth: publicOrigin must be a bare origin like https://example.com, got ${JSON.stringify(value)}`,
    );
  }
  return url.origin;
}

function normaliseRoutePrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, "");
  if (trimmed.length > 0 && !trimmed.startsWith("/")) {
    throw new TypeError(`wardAuth: routePrefix ${JSON.stringify(prefix)} must start with "/"`);
  }
  return trimmed;
}

/** `"GET /health"` stays as it is; `"/health"` becomes `"* /health"` (any method). */
function normalisePublicRoute(entry: string): string {
  const match = /^(?:([A-Z]+)\s+)?(\/\S*)$/.exec(entry.trim());
  if (match === null) {
    throw new TypeError(
      `wardAuth: publicRoutes entry ${JSON.stringify(entry)} is not "METHOD /path" or "/path"`,
    );
  }
  return `${match[1] ?? "*"} ${match[2]}`;
}
