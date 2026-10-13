import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, LightMyRequestResponse } from "fastify";

/**
 * A real Ward, in-process, for the library's tests. **Test-only**: nothing in
 * either bundle imports this file, and the library's runtime never depends on
 * `api/`.
 *
 * Ward is built with its own `buildApp()` over a fresh on-disk database, with
 * `WARD_OIDC_ISSUER` set, exactly as `api/src/oidc/oidc.test.ts` does. Nothing
 * listens on a port. Everything is addressed by **external** URLs
 * (`https://ward.test/ward-api/...`) and the prefix is stripped before
 * `inject`, as Caddy's `handle_path` strips it, so an internal URL leaking into
 * a redirect fails here too.
 *
 * The library reaches Ward through `wardFetch`, a `fetch` that does that
 * stripping — handed to `createWardClient({ fetch })`, it carries discovery,
 * the token request, the JWKS, `/session-status` and `/notify`. `stop()` makes
 * it fail the way a stopped Ward does (connection refused), and `start()`
 * brings it back.
 *
 * Ward's modules are imported by computed path, so this workspace's
 * `tsc --noEmit` does not compile `api/` under its own settings; the few
 * functions used are typed here.
 */

export const WARD_ORIGIN = "https://ward.test";
export const WARD_PREFIX = "/ward-api";
export const WARD_ISSUER = `${WARD_ORIGIN}${WARD_PREFIX}/oidc`;
export const WARD_UI = `${WARD_ORIGIN}/ward`;
/** Every Ward account's password in these tests. */
export const WARD_PASSWORD = "correct-horse-battery-staple";

const API_SRC = fileURLToPath(new URL("../../../api/src/", import.meta.url));

type Db = { exec(sql: string): unknown };

interface WardModules {
  buildApp(): Promise<FastifyInstance>;
  users: {
    createUser(
      db: Db,
      input: { username: string; passwordHash: string; email?: string | null },
    ): {
      subject: string;
    };
    setDisabled(db: Db, subject: string, disabled: boolean): boolean;
    markEmailVerified(db: Db, subject: string, email: string): boolean;
  };
  grants: {
    grantRole(
      db: Db,
      input: { subject: string; appSlug: string; role: string; grantedBy: string },
    ): unknown;
  };
  apps: {
    createApp(db: Db, input: { slug: string; name: string }): unknown;
    setOidcClient(
      db: Db,
      slug: string,
      client: {
        redirectUris: string[];
        postLogoutRedirectUris: string[];
        jwks: { keys: Record<string, unknown>[] } | null;
      },
    ): boolean;
  };
  refresh: {
    revokeFamily(db: Db, familyId: string, reason: "logout" | "admin"): number;
    listLiveTokensForSubject(db: Db, subject: string): Array<{ family_id: string }>;
  };
  resolve: { hasLiveFamily(db: Db, familyId: string, subject: string): boolean };
  password: { hashPassword(password: string): Promise<string> };
  keygen: {
    generateClientKeyPair(): Promise<{
      privateJwk: Record<string, string>;
      publicJwk: Record<string, string>;
      envValue: string;
    }>;
  };
  closeDb(): void;
}

async function load<T>(relative: string): Promise<T> {
  return (await import(/* @vite-ignore */ join(API_SRC, relative))) as T;
}

export interface ClientRegistration {
  slug: string;
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
}

export interface RealWard {
  app: FastifyInstance;
  db: Db;
  modules: WardModules;
  /** `fetch` for the library: external Ward URLs in, `inject` underneath. */
  wardFetch: typeof fetch;
  /** How many requests reached Ward through `wardFetch`, by stripped path. */
  calls: string[];
  /** Make `wardFetch` fail like a stopped Ward; `start()` undoes it. */
  stop(): void;
  start(): void;
  /** Register an OIDC client and return its `WARD_OIDC_CLIENT_KEY` value. */
  registerClient(client: ClientRegistration): Promise<string>;
  /** A Ward account holding the given roles in `appSlug`. Returns the subject. */
  createAccount(username: string, appSlug: string, roles: string[]): Promise<string>;
  /** Inject a request at an external Ward URL, as Caddy would forward it. */
  inject(
    method: string,
    url: string,
    options?: { headers?: Record<string, string>; payload?: string },
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/** Start a Ward. Call once per test file: Ward reads its environment at import. */
export async function startWard(): Promise<RealWard> {
  const dir = await mkdtemp(join(tmpdir(), "ward-auth-lib-"));
  process.env["PORT"] = "8789";
  process.env["HOST"] = "127.0.0.1";
  process.env["WARD_DB_PATH"] = join(dir, "ward.db");
  process.env["WARD_ADMIN_USERNAME"] = "break-glass";
  process.env["WARD_ADMIN_PASSWORD"] = "a-long-random-break-glass-password";
  process.env["WARD_SIGNING_KEY_PATH"] = join(dir, "signing-key.pem");
  process.env["WARD_PUBLIC_ORIGIN"] = WARD_ORIGIN;
  process.env["WARD_MAIL_TRANSPORT"] = "file";
  process.env["WARD_MAIL_FILE_DIR"] = join(dir, "mail");
  process.env["WARD_MAIL_FROM"] = "ward@example.com";
  process.env["WARD_OIDC_ISSUER"] = WARD_ISSUER;
  process.env["WARD_UI_URL"] = WARD_UI;

  const config = await load<{ WARD_SIGNING_KEY_PATH: string }>("config.js");
  const { generateSigningKeyFile } = await load<{
    generateSigningKeyFile(path: string): Promise<void>;
  }>("tokens/keygen.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  const connection = await load<{ getDb(): Promise<Db>; closeDb(): void }>("db/connection.js");
  const db = await connection.getDb();
  (await load<{ runMigrations(db: Db): void }>("db/migrate.js")).runMigrations(db);

  const modules: WardModules = {
    buildApp: (await load<{ buildApp(): Promise<FastifyInstance> }>("app.js")).buildApp,
    users: await load("db/users.js"),
    grants: await load("db/grants.js"),
    apps: await load("db/apps.js"),
    refresh: await load("db/refresh-tokens.js"),
    resolve: await load("grants/resolve.js"),
    password: await load("auth/password.js"),
    keygen: await load("oidc/client-keygen.js"),
    closeDb: connection.closeDb,
  };

  const app = await modules.buildApp();
  await app.ready();

  let stopped = false;
  const calls: string[] = [];

  async function inject(
    method: string,
    url: string,
    options: { headers?: Record<string, string>; payload?: string } = {},
  ): Promise<LightMyRequestResponse> {
    const target = new URL(url);
    if (target.origin !== WARD_ORIGIN || !target.pathname.startsWith(`${WARD_PREFIX}/`)) {
      throw new Error(`not a Ward API URL: ${url}`);
    }
    return app.inject({
      method: method as "GET",
      url: `${target.pathname.slice(WARD_PREFIX.length)}${target.search}`,
      headers: { "x-forwarded-for": "203.0.113.9", ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
  }

  const wardFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (stopped) throw new TypeError("fetch failed");

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init?.body;
    const payload =
      body === undefined || body === null
        ? undefined
        : typeof body === "string"
          ? body
          : body instanceof URLSearchParams
            ? body.toString()
            : String(body);

    calls.push(new URL(url).pathname.slice(WARD_PREFIX.length));
    const response = await inject(init?.method ?? "GET", url, {
      headers,
      ...(payload === undefined ? {} : { payload }),
    });

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        responseHeaders.append(name, String(item));
      }
    }
    const status = response.statusCode;
    const noBody = status === 204 || status === 304 || (init?.method ?? "GET") === "HEAD";
    return new Response(noBody ? null : response.rawPayload, { status, headers: responseHeaders });
  };

  return {
    app,
    db,
    modules,
    wardFetch,
    calls,
    stop: () => {
      stopped = true;
    },
    start: () => {
      stopped = false;
    },
    async registerClient(client) {
      const pair = await modules.keygen.generateClientKeyPair();
      modules.apps.createApp(db, { slug: client.slug, name: client.name });
      modules.apps.setOidcClient(db, client.slug, {
        redirectUris: client.redirectUris,
        postLogoutRedirectUris: client.postLogoutRedirectUris,
        jwks: { keys: [pair.publicJwk] },
      });
      return pair.envValue;
    },
    async createAccount(username, appSlug, roles) {
      const { subject } = modules.users.createUser(db, {
        username,
        passwordHash: await modules.password.hashPassword(WARD_PASSWORD),
        email: `${username}@example.com`,
      });
      modules.users.markEmailVerified(db, subject, `${username}@example.com`);
      for (const role of roles) {
        modules.grants.grantRole(db, { subject, appSlug, role, grantedBy: "superuser" });
      }
      return subject;
    },
    inject,
    async close() {
      await app.close();
      modules.closeDb();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// A browser: one cookie jar per origin, honouring Path
// ---------------------------------------------------------------------------

interface StoredCookie {
  value: string;
  path: string;
}

/**
 * Something that answers a request to the app: the test's Fastify app with the
 * app's API prefix stripped, as the dev server's proxy does.
 */
export interface AppEndpoint {
  origin: string;
  /** The API prefix as the browser sees it, e.g. `/myapp-api`. */
  apiPrefix: string;
  app: FastifyInstance;
}

export class Browser {
  private readonly jars = new Map<string, Map<string, StoredCookie>>();

  constructor(
    private readonly ward: RealWard,
    private readonly target: AppEndpoint,
  ) {}

  cookie(origin: string, name: string): StoredCookie | undefined {
    return this.jars.get(origin)?.get(name);
  }

  /** Every cookie the jar would send to `url`, as a `Cookie` header. */
  cookieHeader(url: string): string | undefined {
    const target = new URL(url);
    const jar = this.jars.get(target.origin);
    if (jar === undefined) return undefined;
    const pairs = [...jar.entries()]
      .filter(([, stored]) => pathMatches(target.pathname, stored.path))
      .map(([name, stored]) => `${name}=${stored.value}`);
    return pairs.length === 0 ? undefined : pairs.join("; ");
  }

  /** A request from this browser to the app's origin or Ward's. */
  async request(
    method: string,
    url: string,
    options: {
      json?: unknown;
      form?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<LightMyRequestResponse> {
    const target = new URL(url);
    const cookie = this.cookieHeader(url);
    const headers: Record<string, string> = { ...options.headers };
    if (cookie !== undefined) headers["cookie"] = cookie;
    let payload: string | undefined;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      payload = new URLSearchParams(options.form).toString();
    }

    let response: LightMyRequestResponse;
    if (target.origin === WARD_ORIGIN) {
      response = await this.ward.inject(method, url, {
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
    } else if (target.origin === this.target.origin) {
      const prefix = this.target.apiPrefix;
      if (!target.pathname.startsWith(`${prefix}/`)) {
        throw new Error(`the test app serves only its API, not ${url}`);
      }
      response = await this.target.app.inject({
        method: method as "GET",
        url: `${target.pathname.slice(prefix.length)}${target.search}`,
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
    } else {
      throw new Error(`this browser knows no ${target.origin}`);
    }
    this.store(target.origin, response);
    return response;
  }

  /** `POST /ward-api/login`, as Ward's login page sends it. */
  async signInAtWard(username: string, password = WARD_PASSWORD): Promise<void> {
    const response = await this.request("POST", `${WARD_ORIGIN}${WARD_PREFIX}/login`, {
      json: { username, password },
    });
    if (response.statusCode !== 200) {
      throw new Error(`Ward sign-in for ${username}: ${response.statusCode} ${response.body}`);
    }
  }

  /**
   * Follow redirects from `url` until the browser lands on one of the app's
   * pages (outside its API), signing in at Ward's login page as `username` if
   * it gets there. Returns the page and whether Ward asked for a password.
   */
  async follow(
    url: string,
    username?: string,
  ): Promise<{ landed: URL; askedForPassword: boolean }> {
    let next = url;
    let askedForPassword = false;
    for (let hop = 0; hop < 12; hop += 1) {
      const at = new URL(next);
      if (
        at.origin === this.target.origin &&
        !at.pathname.startsWith(`${this.target.apiPrefix}/`)
      ) {
        return { landed: at, askedForPassword };
      }
      if (at.origin === WARD_ORIGIN && at.pathname === "/ward/login") {
        askedForPassword = true;
        if (username === undefined) throw new Error("Ward asked for a password; no username given");
        await this.signInAtWard(username);
        // What Ward's login page does after a successful sign-in.
        next = `${WARD_ORIGIN}${WARD_PREFIX}/refresh/oidc/${at.searchParams.get("oidc")}`;
        continue;
      }

      let response = await this.request("GET", next);
      // The provider's self-submitting form: do what its script would.
      if (response.statusCode === 200 && /document\.forms\[0\]\.submit/.test(response.body)) {
        const action = /<form method="post" action="([^"]+)"/.exec(response.body)![1]!;
        const fields = Object.fromEntries(
          [
            ...response.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g),
          ].map((match) => [match[1]!, match[2]!]),
        );
        response = await this.request("POST", action.replaceAll("&amp;", "&"), { form: fields });
      }
      const location = response.headers.location;
      if (![302, 303].includes(response.statusCode) || typeof location !== "string") {
        throw new Error(`${next} → ${response.statusCode} ${response.body.slice(0, 300)}`);
      }
      next = new URL(location, next).href;
    }
    throw new Error("the flow did not land in 12 hops");
  }

  private store(origin: string, response: LightMyRequestResponse): void {
    const raw = response.headers["set-cookie"];
    const headers = raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
    let jar = this.jars.get(origin);
    if (jar === undefined) {
      jar = new Map();
      this.jars.set(origin, jar);
    }
    for (const header of headers) {
      const [pair, ...attributes] = header.split(";").map((part) => part.trim());
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      let path = "/";
      let expired = value === "";
      for (const attribute of attributes) {
        const [key, attributeValue = ""] = attribute.split("=");
        if (key!.toLowerCase() === "path") path = attributeValue;
        if (key!.toLowerCase() === "max-age" && Number(attributeValue) <= 0) expired = true;
      }
      if (expired) jar.delete(name);
      else jar.set(name, { value, path });
    }
  }
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}
