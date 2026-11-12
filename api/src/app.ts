import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { errorsPlugin } from "./plugins/errors.js";
import { accountRoutes } from "./features/account/index.js";
import {
  adminAccountsRoutes,
  adminAppsRoutes,
  adminAuditRoutes,
  adminGrantsRoutes,
  adminSessionsRoutes,
} from "./features/admin/index.js";
import { authRoutes } from "./features/auth/index.js";
import { consoleRoutes } from "./features/console/index.js";
import { healthRoutes } from "./features/health/index.js";
import { jwksRoutes } from "./features/jwks/index.js";
import { notifyRoutes } from "./features/notify/index.js";
import { publicAppsRoutes } from "./features/public-apps/index.js";
import { registerRoutes } from "./features/register/index.js";
import { sessionRoutes, sessionStatusRoutes } from "./features/session/index.js";
import { oidcRoutes } from "./oidc/routes.js";

/**
 * Construct and configure the Fastify instance — nothing more.
 *
 * Deliberately free of side effects beyond that: no `listen()`, no
 * `runMigrations()`, no reach into `db`. Two reasons. First, `server.ts` needs
 * migrations to finish (see there) strictly before the listener binds, and
 * that ordering is easiest to get right when this function cannot itself open
 * a socket. Second, the tests want to build an app in-process (e.g. with
 * `app.inject()`) without a live port or a real database on disk. Keep it
 * that way: route modules register their plugins into the instance this returns, they do not
 * add their own `listen()` calls.
 */
export interface BuildAppOptions {
  /**
   * The process's server options, which `server.ts` passes (its
   * `keepAliveTimeout`). Tests pass none and get Fastify's defaults.
   */
  server?: Pick<FastifyServerOptions, "keepAliveTimeout">;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    ...options.server,
    logger: true,
    // Fastify's default request log line uses the built-in `req` serializer,
    // which logs only method, url, host, remoteAddress, remotePort and the
    // accept-version header. General request headers — a future
    // `Authorization`, say — are NOT logged, and neither is the body, which
    // is what we want: routes carry credentials (passwords, refresh
    // tokens) in POST bodies, and those must never reach the log. But `url`
    // does carry the query string, so every info-level log line contains
    // whatever query parameters the request had — login and refresh
    // need to keep that in mind when deciding what is allowed to travel in
    // a URL. Nothing here overrides the default; naming it so a future
    // change to `logger` doesn't casually turn body or header logging on.
  });

  // The zod type provider's compilers, on the root before any plugin, so every scope inherits
  // them: Fastify validates each request and encodes each reply through the route's zod schemas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // First, so it covers every route: a plugin registered before it would own its scope with
  // Fastify's default handler. See `plugins/errors.ts` for the four cases.
  await app.register(errorsPlugin);

  await app.register(healthRoutes);
  await app.register(jwksRoutes);
  await app.register(authRoutes);
  await app.register(consoleRoutes);

  /**
   * `GET /session` — "who am I" for Ward's own pages, from the `ward_session`
   * cookie. Apps never call it; see `routes/session.ts`.
   */
  await app.register(sessionRoutes);

  /**
   * `POST /notify`: an app asks Ward to mail one of its own users,
   * authenticated with its client assertion. See `routes/notify.ts`.
   */
  await app.register(notifyRoutes);

  // The five admin plugins each attach `requireConsoleSession` as a
  // plugin-scope preValidation hook, so registering them here does not open anything —
  // they gate themselves. Their paths all sit under `/console/` and that is
  // functional rather than cosmetic: the `ward_console` cookie is scoped to
  // `Path=/ward-api/console`, so a route mounted anywhere else would simply
  // never receive it.
  //
  // `adminSessionsRoutes` adds paths *under* `/console/accounts/:subject`,
  // which `adminAccountsRoutes` already claims. That is not a conflict — the
  // parameter is named `:subject` in both, so find-my-way merges the two into
  // one radix tree — but the two plugins must keep agreeing on that name, or
  // Fastify refuses to boot with a parametric-conflict error rather than
  // failing at request time.
  await app.register(adminAppsRoutes);
  await app.register(adminGrantsRoutes);
  await app.register(adminAccountsRoutes);
  await app.register(adminSessionsRoutes);
  await app.register(adminAuditRoutes);

  /**
   * The self-service surface, authenticated as an **ordinary account** from the
   * `ward_session` cookie — emphatically not through the console, which is
   * superuser-only by decision and has no second path into it. See the header
   * of `routes/account.ts`.
   */
  await app.register(accountRoutes);

  /**
   * `GET /apps` — the only **anonymous read** in the estate.
   *
   * Registered next to the anonymous write below so that what an
   * unauthenticated caller can reach is visible in one place. It answers the
   * apps whose `public_registration` flag is on, and nothing about the ones it
   * is off for.
   */
  await app.register(publicAppsRoutes);

  /**
   * Public registration and email verification, last because it is the only
   * anonymous *write* surface in the estate — worth being able to find in one
   * place when reasoning about what an unauthenticated caller can reach.
   *
   * It registers `/verify` inside its own encapsulated scope with a `req` log
   * serializer that redacts the whole query string. That is load-bearing rather
   * than tidy: the verification link has to be clickable from a mail client, so
   * the token travels in a URL, and Fastify writes its `incoming request` line
   * before any `onRequest` hook could scrub it.
   */
  await app.register(registerRoutes);

  /**
   * The OpenID Connect provider: `/oidc/*` and its login step at
   * `/refresh/oidc/:uid`. Mounted only when `WARD_OIDC_ISSUER` is set. It is
   * how every app signs people in since the cutover; the routes
   * above serve Ward's own pages. See the header of `oidc/routes.ts` for how
   * the stripped `/ward-api` prefix is put back into every URL it advertises.
   */
  await app.register(oidcRoutes);

  /**
   * `POST /session-status`: an app asks whether a Ward-originated
   * session is still live, authenticated with its client assertion. Registers
   * nothing when `WARD_OIDC_ISSUER` is unset, like the provider above. See
   * `routes/session-status.ts`.
   */
  await app.register(sessionStatusRoutes);

  // Registration order carries no meaning — these plugins share no state and
  // no route prefix, and each declares its own paths. It roughly follows the order
  // the routes were built in.
  //
  // Both `authRoutes` and `consoleRoutes` accept an options object with a `db`
  // for tests; neither is given one here, so both resolve the process-wide
  // handle lazily on first request rather than at registration. That is what
  // keeps `buildApp()` callable with no database on disk.

  return app;
}
