import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from "fastify";
import type Provider from "oidc-provider";

import { getDb } from "../db/connection.js";
import { getKeySet } from "../tokens/service.js";
import { sweepExpiredOidcRows } from "./adapter.js";
import { interactionRoutes } from "./interaction.js";
import { OIDC_INTERNAL_PREFIX, oidcLayout, type OidcLayout } from "./layout.js";
import { createWardProvider } from "./provider.js";

/**
 * Mount Ward's OpenID Connect provider (brief 18).
 *
 * Registered by `app.ts`. When `WARD_OIDC_ISSUER` is unset this registers
 * nothing at all, so a Ward deployed before its issuer is configured serves
 * exactly the routes it served before.
 *
 * ## What is mounted, internally and externally
 *
 * | Fastify sees | The browser / an app sees (issuer `…/ward-api/oidc`) |
 * |---|---|
 * | `/oidc/*` | `/ward-api/oidc/*` — discovery, JWKS, auth, token, end-session |
 * | `/refresh/oidc/:uid` | `/ward-api/refresh/oidc/:uid` — the login step |
 *
 * The provider is a Koa application. Each `/oidc/*` request is handed to it
 * raw, after three rewrites that make it describe itself by the issuer rather
 * than by the request Fastify received: the path loses `/oidc` (the provider
 * routes from its own root), `originalUrl` gains the issuer's path (the
 * provider reads its mount from the difference), and the forwarded host and
 * protocol are overwritten with the issuer's (so a request's own headers
 * cannot change what it advertises). `oidc.test.ts` asserts that every URL in
 * discovery starts with the issuer.
 *
 * ## Bodies are the provider's
 *
 * The token endpoint takes `application/x-www-form-urlencoded`, which Fastify
 * has no parser for. Inside this plugin's own scope every content type gets a
 * parser that reads nothing, so the stream reaches the provider untouched and
 * it applies its own size limit and parsing.
 */

export interface OidcRoutesOptions {
  /** Tests hand in a database; production resolves the process-wide one. */
  db?: Database.Database;
}

/** Housekeeping cadence for expired provider rows. Reads ignore them anyway. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const METHODS: HTTPMethods[] = ["GET", "POST", "OPTIONS"];

export interface OidcBundle {
  db: Database.Database;
  provider: Provider;
  layout: OidcLayout;
  handle: (req: FastifyRequest["raw"], res: FastifyReply["raw"]) => Promise<void>;
}

export async function oidcRoutes(
  app: FastifyInstance,
  options: OidcRoutesOptions = {},
): Promise<void> {
  const { OIDC } = await import("../config.js");
  if (OIDC === undefined) {
    app.log.info("WARD_OIDC_ISSUER is unset; the OpenID Connect provider is not mounted");
    return;
  }
  const layout = oidcLayout(OIDC.issuer, OIDC.uiUrl);

  /**
   * Built on first use rather than at registration, for the reason `app.ts`
   * gives about `getDb`: `buildApp()` must stay callable with no database on
   * disk. The signing key, by contrast, is already loaded at registration by
   * `routes/jwks.ts`, so `getKeySet()` here only reads its cache.
   */
  let built: Promise<OidcBundle> | undefined;
  let sweeper: NodeJS.Timeout | undefined;

  const bundle = (): Promise<OidcBundle> => {
    built ??= (async () => {
      const db = options.db ?? (await getDb());
      const provider = createWardProvider({ db, layout, keySet: await getKeySet() });
      const callback = provider.callback();

      sweep(db, app);
      sweeper = setInterval(() => sweep(db, app), SWEEP_INTERVAL_MS);
      sweeper.unref();

      return {
        db,
        provider,
        layout,
        handle: async (req, res) => {
          await callback(req, res);
        },
      };
    })();
    return built;
  };

  app.addHook("onClose", async () => {
    if (sweeper !== undefined) clearInterval(sweeper);
  });

  app.log.info(
    { issuer: layout.issuer, mount: OIDC_INTERNAL_PREFIX, strippedPrefix: layout.strippedPrefix },
    "OpenID Connect provider mounted",
  );

  await app.register(
    async (scope: FastifyInstance): Promise<void> => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser("*", (_request, _payload, done) => {
        done(null, undefined);
      });

      const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const { handle } = await bundle();
        rewriteForProvider(request.raw, layout);
        reply.hijack();
        await handle(request.raw, reply.raw);
      };

      scope.route({ method: METHODS, url: OIDC_INTERNAL_PREFIX, handler });
      scope.route({ method: METHODS, url: `${OIDC_INTERNAL_PREFIX}/*`, handler });
    },
    { logSerializers: oidcLogSerializers },
  );

  await app.register(
    async (scope: FastifyInstance): Promise<void> => {
      await interactionRoutes(scope, { resolve: bundle, layout });
    },
    { logSerializers: oidcLogSerializers },
  );
}

/**
 * Make one raw request describe itself the way the browser addressed it.
 * Exported for the layout test.
 *
 * The provider derives its mount as `originalUrl.slice(0, originalUrl.indexOf(url))`,
 * the first place the internal path occurs in the external one. So the stripped
 * prefix must not itself contain a provider route (`/auth`, `/token`, `/jwks`,
 * `/me`, `/request`, `/session`), or every advertised URL would be cut short.
 * `/ward-api`, and a subdomain with no prefix, are safe; `.env.example` says so
 * beside `WARD_OIDC_ISSUER`.
 */
export function rewriteForProvider(
  raw: FastifyRequest["raw"] & { originalUrl?: string },
  layout: OidcLayout,
): void {
  const internal = raw.url ?? "/";
  let rest = internal.slice(OIDC_INTERNAL_PREFIX.length);
  if (!rest.startsWith("/")) rest = `/${rest}`;
  raw.url = rest;
  raw.originalUrl = `${layout.issuerPath}${rest}`;
  raw.headers["x-forwarded-host"] = layout.host;
  raw.headers["x-forwarded-proto"] = layout.protocol;
}

function sweep(db: Database.Database, app: FastifyInstance): void {
  try {
    const removed = sweepExpiredOidcRows(db);
    if (removed.payloads + removed.authorizations > 0) {
      app.log.info(removed, "oidc: swept expired rows");
    }
  } catch (err) {
    // A failed sweep costs disk space, never correctness: reads already
    // ignore expired rows. Logged, not thrown, so a locked database at 3am
    // does not take the process down with it.
    app.log.warn({ err }, "oidc: expiry sweep failed");
  }
}

/**
 * The provider's URLs carry things that should not sit in a log line: the
 * end-session endpoint takes an `id_token_hint` in the query, the authorization
 * endpoint a `state` and a `nonce`. The same move as `/verify`: the query string
 * is dropped from the request log wholesale. See `routes/register.ts` for why
 * the return type has to be cast.
 */
const oidcLogSerializers: Record<string, (value: unknown) => string> = {
  req: ((request: FastifyRequest): unknown => {
    const mark = request.url.indexOf("?");
    return {
      method: request.method,
      url: mark === -1 ? request.url : `${request.url.slice(0, mark)}?<redacted>`,
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket.remotePort,
    };
  }) as unknown as (value: unknown) => string,
};
