import Database from "better-sqlite3";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_RENEW_INTERVAL_SECONDS,
  createAccounts,
  seedUsers,
  type Accounts,
} from "../core/accounts.js";
import { LOCKOUT_MAX_FAILURES } from "../core/lockout.js";
import { createSqliteStore, type SqliteHandle } from "../store/sqlite.js";
import { requireRole, wardAuth, type WardAuthOptions } from "./plugin.js";

/**
 * The plugin end to end, through Fastify's `inject`: real routes, the real
 * guard, a real SQLite store. Nothing is mocked.
 */

const ORIGIN = "http://localhost:5173";
const COOKIE = "demo_session";
const COOKIE_PATH = "/demo/api";

let app: FastifyInstance | undefined;
let clock = Date.UTC(2026, 9, 13, 12, 0, 0);

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface Harness {
  app: FastifyInstance;
  accounts: Accounts;
  db: SqliteHandle;
}

async function build(
  overrides: Partial<WardAuthOptions> = {},
  db: SqliteHandle = new Database(":memory:"),
): Promise<Harness> {
  const accounts = createAccounts({ store: createSqliteStore(db), now: () => clock });
  await seedUsers(accounts, [
    { username: "alice", password: "correct horse", role: "admin" },
    { username: "bob", password: "bob's password", role: "member" },
  ]);

  const instance = Fastify();
  await instance.register(wardAuth, {
    accounts,
    cookieName: COOKIE,
    cookiePath: COOKIE_PATH,
    publicOrigin: ORIGIN,
    publicRoutes: ["GET /health"],
    now: () => clock,
    ...overrides,
  });

  instance.get("/health", async () => ({ ok: true }));
  instance.get("/me", async (request) => ({ user: request.auth?.user ?? null }));
  instance.delete("/things/:id", { preHandler: requireRole("admin") }, async () => ({
    deleted: true,
  }));
  await instance.register(async (child) => {
    child.get("/nested", async (request) => ({ id: request.auth?.user.id }));
  });

  await instance.ready();
  app = instance;
  return { app: instance, accounts, db };
}

/** The session cookie a response set, as `name=value`, or undefined. */
function cookieFrom(response: LightMyRequestResponse): string | undefined {
  const header = response.headers["set-cookie"];
  const all = Array.isArray(header) ? header : header === undefined ? [] : [header];
  const ours = all.find((value) => value.startsWith(`${COOKIE}=`));
  return ours?.split(";")[0];
}

function setCookieHeader(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.join("\n") : (header ?? "");
}

async function login(
  h: Harness,
  username: string,
  password: string,
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
    headers,
  });
}

describe("end to end", () => {
  it("seed, login, guarded route, password change ends other sessions, logout", async () => {
    const h = await build();

    // Signed out: the guard refuses, and "who am I" answers null rather than an error.
    expect((await h.app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/auth/session" })).json()).toEqual({
      user: null,
      session: null,
      ward: { enabled: false, linked: false },
    });

    // Two sign-ins: this browser and a second device.
    const here = await login(h, "alice", "correct horse");
    expect(here.statusCode).toBe(200);
    expect(here.json()).toMatchObject({
      user: { username: "alice", role: "admin", hasPassword: true },
    });
    const hereCookie = cookieFrom(here)!;
    const elsewhereCookie = cookieFrom(await login(h, "alice", "correct horse"))!;
    expect(hereCookie).not.toBe(elsewhereCookie);

    // The guarded route sees the user; so does a route in a child plugin.
    const me = await h.app.inject({ method: "GET", url: "/me", headers: { cookie: hereCookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { username: "alice" } });
    const nested = await h.app.inject({
      method: "GET",
      url: "/nested",
      headers: { cookie: elsewhereCookie },
    });
    expect(nested.statusCode).toBe(200);

    // Change the password from here: the other device is signed out, this one stays.
    const change = await h.app.inject({
      method: "POST",
      url: "/auth/password",
      headers: { cookie: hereCookie },
      payload: { currentPassword: "correct horse", newPassword: "battery staple" },
    });
    expect(change.statusCode).toBe(204);
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie: elsewhereCookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie: hereCookie } }))
        .statusCode,
    ).toBe(200);
    expect((await login(h, "alice", "correct horse")).statusCode).toBe(401);
    expect((await login(h, "alice", "battery staple")).statusCode).toBe(200);

    // Logout ends the session and clears the cookie at the same path.
    const out = await h.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: hereCookie },
    });
    expect(out.statusCode).toBe(204);
    expect(setCookieHeader(out)).toContain(`${COOKIE}=; Path=${COOKIE_PATH}`);
    expect(setCookieHeader(out)).toContain("Max-Age=0");
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie: hereCookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("works the same over node:sqlite, as sports-app hands it", async () => {
    const h = await build({}, new DatabaseSync(":memory:"));
    const cookie = cookieFrom(await login(h, "bob", "bob's password"))!;
    const me = await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ user: { username: "bob", role: "member" } });
  });
});

describe("the cookie", () => {
  it("is HttpOnly, SameSite=Lax, scoped to the API path, and not Secure on loopback HTTP", async () => {
    const h = await build();
    const header = setCookieHeader(await login(h, "alice", "correct horse"));

    expect(header).toMatch(
      new RegExp(
        `^${COOKIE}=[A-Za-z0-9_-]{43}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=\\d+$`,
      ),
    );
  });

  it("is Secure for an HTTPS origin", async () => {
    const h = await build({ publicOrigin: "https://example.com" });
    expect(setCookieHeader(await login(h, "alice", "correct horse"))).toContain("; Secure");
  });

  it("is re-sent with a fresh Max-Age when the sliding expiry moves, and not before", async () => {
    const h = await build();
    const cookie = cookieFrom(await login(h, "alice", "correct horse"))!;

    const early = await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(early.headers["set-cookie"]).toBeUndefined();

    clock += SESSION_RENEW_INTERVAL_SECONDS * 1000;
    const later = await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(cookieFrom(later)).toBe(cookie);
  });

  it("is cleared when it names no session", async () => {
    const h = await build();
    const stale = await h.app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: `${COOKIE}=nonsense` },
    });
    expect(stale.statusCode).toBe(401);
    expect(setCookieHeader(stale)).toContain("Max-Age=0");
  });

  it("refuses an unusable configuration at boot", async () => {
    await expect(build({ cookieName: "bad name" })).rejects.toThrow(/cookieName/);
    await expect(build({ cookiePath: "api" })).rejects.toThrow(/cookiePath/);
    await expect(build({ publicOrigin: "https://example.com/app" })).rejects.toThrow(/bare origin/);
  });
});

describe("the guard", () => {
  it("lets allowlisted routes, the plugin's own public routes and preflights through", async () => {
    const h = await build();
    expect((await h.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "HEAD", url: "/health" })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "GET", url: "/health?x=1" })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "OPTIONS", url: "/me" })).statusCode).not.toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/auth/logout" })).statusCode).toBe(204);
  });

  it("matches the route pattern, not the URL, and fails closed on an unknown path", async () => {
    const h = await build({ publicRoutes: ["GET /health"] });
    expect((await h.app.inject({ method: "POST", url: "/health" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/no/such/route" })).statusCode).toBe(401);
  });

  it("accepts an isPublic predicate for what patterns cannot say", async () => {
    const h = await build({ isPublic: (request) => request.url.startsWith("/nested") });
    expect((await h.app.inject({ method: "GET", url: "/nested" })).statusCode).toBe(200);
  });

  it("guards the password route: no session, no change", async () => {
    const h = await build();
    const response = await h.app.inject({
      method: "POST",
      url: "/auth/password",
      payload: { currentPassword: "correct horse", newPassword: "battery staple" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("requireRole lets through only the named roles", async () => {
    const h = await build();
    const admin = cookieFrom(await login(h, "alice", "correct horse"))!;
    const member = cookieFrom(await login(h, "bob", "bob's password"))!;

    expect(
      (await h.app.inject({ method: "DELETE", url: "/things/1", headers: { cookie: admin } }))
        .statusCode,
    ).toBe(200);
    const refused = await h.app.inject({
      method: "DELETE",
      url: "/things/1",
      headers: { cookie: member },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: "forbidden" });
  });
});

describe("the validateSession hook", () => {
  it("refuses the request with the validator's reason, on guarded routes and in /session", async () => {
    const h = await build({
      validateSession: (resolved) =>
        resolved.user.username === "bob" ? { ok: false, reason: "ward_unavailable" } : { ok: true },
    });
    const bob = cookieFrom(await login(h, "bob", "bob's password"))!;
    const alice = cookieFrom(await login(h, "alice", "correct horse"))!;

    const refused = await h.app.inject({ method: "GET", url: "/me", headers: { cookie: bob } });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: "unauthorized", reason: "ward_unavailable" });
    expect(
      (
        await h.app.inject({ method: "GET", url: "/auth/session", headers: { cookie: bob } })
      ).json(),
    ).toEqual({
      user: null,
      session: null,
      reason: "ward_unavailable",
      ward: { enabled: false, linked: false },
    });

    // Not ended: when the check passes again, the same cookie works.
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie: alice } })).statusCode,
    ).toBe(200);
  });

  it("ends the session when the verdict says so", async () => {
    let calls = 0;
    const h = await build({
      validateSession: () => {
        calls += 1;
        return { ok: false, reason: "revoked", endSession: true };
      },
    });
    const cookie = cookieFrom(await login(h, "bob", "bob's password"))!;

    const first = await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(first.json()).toEqual({ error: "unauthorized", reason: "revoked" });
    expect(setCookieHeader(first)).toContain("Max-Age=0");

    // The row is gone, so the validator is never consulted again for it.
    await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(calls).toBe(1);
  });

  it("fails closed when a validator throws", async () => {
    const h = await build({
      validateSession: async () => {
        throw new Error("network down");
      },
    });
    const cookie = cookieFrom(await login(h, "bob", "bob's password"))!;
    const response = await h.app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized", reason: "session_check_failed" });
  });
});

describe("login", () => {
  it("gives one answer for an unknown user and a wrong password", async () => {
    const h = await build();
    const unknown = await login(h, "nobody", "correct horse");
    const wrong = await login(h, "alice", "wrong horse");
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(unknown.json()).toEqual({ error: "invalid_credentials" });
  });

  it("answers a malformed body with 400 and does not count it", async () => {
    const h = await build();
    for (let i = 0; i < LOCKOUT_MAX_FAILURES + 2; i += 1) {
      expect(
        (await h.app.inject({ method: "POST", url: "/auth/login", payload: { username: "alice" } }))
          .statusCode,
      ).toBe(400);
    }
    expect((await login(h, "alice", "correct horse")).statusCode).toBe(200);
  });

  it("locks the forwarded address out on the sixth attempt, and only that address", async () => {
    const h = await build();
    // inject's peer is 127.0.0.1, as behind Caddy: the LAST forwarded element counts.
    const attacker = { "x-forwarded-for": "1.2.3.4, 203.0.113.9" };
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      expect((await login(h, "alice", "wrong horse", attacker)).statusCode).toBe(401);
    }

    const locked = await login(h, "alice", "correct horse", attacker);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(locked.json()).toMatchObject({ error: "too_many_attempts" });

    // Spoofing the first element changes nothing: the last is what counts.
    expect(
      (await login(h, "alice", "correct horse", { "x-forwarded-for": "9.9.9.9, 203.0.113.9" }))
        .statusCode,
    ).toBe(429);
    // A different address — and so the real alice — is untouched.
    expect(
      (await login(h, "alice", "correct horse", { "x-forwarded-for": "198.51.100.4" })).statusCode,
    ).toBe(200);
  });

  it("refuses a cross-site browser request before looking at credentials", async () => {
    const h = await build();
    expect(
      (await login(h, "alice", "correct horse", { origin: "https://evil.example" })).statusCode,
    ).toBe(403);
    expect(
      (await login(h, "alice", "correct horse", { "sec-fetch-site": "cross-site" })).statusCode,
    ).toBe(403);
    expect(
      (
        await login(h, "alice", "correct horse", {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("replaces the session the browser already held", async () => {
    const h = await build();
    const first = cookieFrom(await login(h, "alice", "correct horse"))!;
    await login(h, "alice", "correct horse", { cookie: first });
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie: first } })).statusCode,
    ).toBe(401);
  });
});

describe("trusted proxies (0.3.0)", () => {
  /**
   * Ward's brief 28, which 0.2.0 inherited. In a container the peer is a Docker
   * bridge address — Docker's proxy on the host, or a Caddy container — never
   * loopback, so the forwarded address was ignored and every caller shared the
   * proxy's one budget.
   */
  const PROXY = "172.19.0.3";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function viaProxy(h: Harness, client: string, username: string, password: string) {
    return h.app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: PROXY,
      headers: { "x-forwarded-for": `198.51.100.250, ${client}` },
      payload: { username, password },
    });
  }

  it("reads AUTH_TRUSTED_PROXIES when the option is absent", async () => {
    vi.stubEnv("AUTH_TRUSTED_PROXIES", "10.0.0.0/8, 172.16.0.0/12");
    const h = await build();

    for (let caller = 1; caller <= 6; caller += 1) {
      const response = await viaProxy(h, `203.0.113.${caller}`, `user-${caller}`, "wrong");
      expect(response.statusCode, `caller ${caller}`).toBe(401);
    }
    // The seventh caller, behind the same proxy, signs in.
    expect((await viaProxy(h, "203.0.113.7", "alice", "correct horse")).statusCode).toBe(200);

    // One caller is still locked out on its own sixth attempt.
    for (let i = 0; i < LOCKOUT_MAX_FAILURES - 1; i += 1) {
      await viaProxy(h, "203.0.113.1", "alice", "wrong");
    }
    expect((await viaProxy(h, "203.0.113.1", "alice", "correct horse")).statusCode).toBe(429);
  });

  it("uses the option as given, and then never reads the environment", async () => {
    vi.stubEnv("AUTH_TRUSTED_PROXIES", "172.16.0.0/12");
    const h = await build({ trustedProxies: [] });

    // Loopback only: the bridge peer is untrusted, so everyone behind it is
    // one caller — the 0.2.0 behaviour, kept when it is asked for.
    for (let caller = 1; caller <= LOCKOUT_MAX_FAILURES; caller += 1) {
      await viaProxy(h, `203.0.113.${caller}`, `user-${caller}`, "wrong");
    }
    expect((await viaProxy(h, "203.0.113.99", "alice", "correct horse")).statusCode).toBe(429);
  });

  it("trusts only loopback when neither is set", async () => {
    vi.stubEnv("AUTH_TRUSTED_PROXIES", undefined);
    const h = await build();
    for (let caller = 1; caller <= LOCKOUT_MAX_FAILURES; caller += 1) {
      await viaProxy(h, `203.0.113.${caller}`, `user-${caller}`, "wrong");
    }
    expect((await viaProxy(h, "203.0.113.99", "alice", "correct horse")).statusCode).toBe(429);
  });

  it("refuses to register with a malformed entry, naming where it came from", async () => {
    await expect(build({ trustedProxies: ["172.16.0.0/33"] })).rejects.toThrow(
      /wardAuth: trustedProxies: .*"172\.16\.0\.0\/33"/,
    );

    vi.stubEnv("AUTH_TRUSTED_PROXIES", "172.16.0.0/12, docker0");
    await expect(build()).rejects.toThrow(/wardAuth: AUTH_TRUSTED_PROXIES: .*"docker0"/);

    vi.stubEnv("AUTH_TRUSTED_PROXIES", "0.0.0.0/0");
    await expect(build()).rejects.toThrow(/trusts every address/);
  });
});

describe("password change", () => {
  it("answers a wrong current password and a policy failure with their codes", async () => {
    const h = await build();
    const cookie = cookieFrom(await login(h, "alice", "correct horse"))!;
    const post = (payload: object) =>
      h.app.inject({ method: "POST", url: "/auth/password", headers: { cookie }, payload });

    const wrong = await post({ currentPassword: "wrong horse", newPassword: "battery staple" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "invalid_credentials" });

    const short = await post({ currentPassword: "correct horse", newPassword: "short" });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({ error: "password_too_short" });

    // A wrong current password did not sign this session out.
    expect(
      (await h.app.inject({ method: "GET", url: "/me", headers: { cookie } })).statusCode,
    ).toBe(200);
  });
});

describe("registration", () => {
  it("does not exist unless the app turns it on", async () => {
    const h = await build();
    const response = await h.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "carol", password: "carol's password" },
    });
    expect([401, 404]).toContain(response.statusCode);
    expect(await h.accounts.findUserByUsername("carol")).toBeUndefined();
  });

  it("creates a user with the configured role and signs them in", async () => {
    const h = await build({ registration: { role: "contributor" } });
    const response = await h.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "carol", password: "carol's password" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ user: { username: "carol", role: "contributor" } });

    const me = await h.app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: cookieFrom(response)! },
    });
    expect(me.json()).toMatchObject({ user: { username: "carol" } });
  });

  it("answers a taken name and a bad name with their codes, and throttles the address", async () => {
    const h = await build({ registration: { role: "contributor" } });
    const register = (username: string, password = "long enough") =>
      h.app.inject({ method: "POST", url: "/auth/register", payload: { username, password } });

    expect((await register("ALICE")).json()).toEqual({ error: "username_taken" });
    expect((await register("al ice")).json()).toEqual({ error: "invalid_username" });
    expect((await register("dave", "short")).json()).toEqual({ error: "password_too_short" });
    await register("erin");
    await register("frank");
    // Five attempts spent from this address: the sixth is refused.
    expect((await register("grace")).statusCode).toBe(429);
  });
});
