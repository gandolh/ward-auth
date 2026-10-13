import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Brief 28 through the routes: Ward behind a proxy that is **not** loopback.
 *
 * In a container the socket peer is a Docker bridge address — Docker's proxy
 * on the host, the Caddy container locally — and before this brief Ward
 * ignored `X-Forwarded-For` from it, so every request keyed on that one
 * address. Five bad passwords for five usernames then locked a sixth caller
 * with its own forwarded address out of `/login` for fifteen minutes.
 *
 * A **separate test file on purpose**: it sets `WARD_TRUSTED_PROXIES` and lets
 * the routes read it through `config.ts`, which resolves once per module
 * registry, and vitest gives each test file its own. `app.inject`'s
 * `remoteAddress` stands in for the bridge peer.
 */

const PROXY = "10.87.92.3"; // inside WARD_TRUSTED_PROXIES below
const STRANGER = "172.19.0.3"; // a bridge address nobody listed

let dir: string;
let app: FastifyInstance;
let db: Database.Database;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-trusted-proxies-"));

  process.env["PORT"] = "8797";
  process.env["HOST"] = "127.0.0.1";
  process.env["WARD_DB_PATH"] = join(dir, "unused.db");
  process.env["WARD_ADMIN_USERNAME"] = "test-superuser";
  process.env["WARD_ADMIN_PASSWORD"] = "test-superuser-password";
  process.env["WARD_SIGNING_KEY_PATH"] = join(dir, "signing-key.pem");
  process.env["WARD_PUBLIC_ORIGIN"] = "https://example.com";
  process.env["WARD_MAIL_TRANSPORT"] = "file";
  process.env["WARD_MAIL_FILE_DIR"] = join(dir, "outbox");
  process.env["WARD_MAIL_FROM"] = "ward@example.com";
  process.env["WARD_TRUSTED_PROXIES"] = "10.87.92.0/24, fd00:87:92::/64";

  const config = await import("../config.js");
  const { generateSigningKeyFile } = await import("../tokens/keygen.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  const { freshDb } = await import("../db/test-support.js");
  db = freshDb();

  // Neither plugin is handed `trustedProxies`: both must find the same list in
  // `config.ts`, or `/login` and `/console/login` disagree about an address.
  const { authRoutes } = await import("./auth.js");
  const { consoleRoutes } = await import("./console.js");
  const Fastify = (await import("fastify")).default;
  app = Fastify({ logger: false });
  await app.register(authRoutes, { db });
  await app.register(consoleRoutes, { db });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  db?.close();
  await rm(dir, { recursive: true, force: true });
  delete process.env["WARD_TRUSTED_PROXIES"];
});

beforeEach(async () => {
  const { resetLockoutForTests } = await import("../auth/lockout.js");
  resetLockoutForTests();
});

function badLogin(peer: string, forwardedFor: string, username: string) {
  return app.inject({
    method: "POST",
    url: "/login",
    remoteAddress: peer,
    headers: { "x-forwarded-for": forwardedFor },
    payload: { username, password: "wrong-password" },
  });
}

describe("a proxy inside WARD_TRUSTED_PROXIES", () => {
  it("gives every forwarded caller its own budget", async () => {
    for (let caller = 1; caller <= 6; caller += 1) {
      const response = await badLogin(PROXY, `198.51.100.${caller}`, `user-${caller}`);
      expect(response.statusCode, `caller ${caller}`).toBe(401);
    }

    // The seventh caller, from its own address, is not locked out.
    const seventh = await badLogin(PROXY, "198.51.100.7", "user-7");
    expect(seventh.statusCode).toBe(401);
  });

  it("still locks out one caller, and a spoofed first element does not help", async () => {
    // The client sends `X-Forwarded-For: <anything>`; the proxy appends the
    // address it saw. Only that last element counts.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await badLogin(PROXY, `203.0.113.${attempt}, 198.51.100.50`, "alice");
      expect(response.statusCode).toBe(401);
    }

    const sixth = await badLogin(PROXY, "203.0.113.99, 198.51.100.50", "alice");
    expect(sixth.statusCode).toBe(429);
  });

  it("matches the proxy as an IPv4-mapped peer and over IPv6", async () => {
    for (let caller = 1; caller <= 6; caller += 1) {
      const peer = caller % 2 === 0 ? `::ffff:${PROXY}` : "fd00:87:92::3";
      expect((await badLogin(peer, `198.51.100.${caller}`, "bob")).statusCode).toBe(401);
    }
  });

  it("keys /console/login on the same address /login does", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/console/login",
        remoteAddress: PROXY,
        headers: { "x-forwarded-for": "198.51.100.60" },
        payload: { username: "test-superuser", password: "wrong" },
      });
      expect(response.statusCode).toBe(401);
    }

    const locked = await app.inject({
      method: "POST",
      url: "/console/login",
      remoteAddress: PROXY,
      headers: { "x-forwarded-for": "198.51.100.60" },
      payload: { username: "test-superuser", password: "wrong" },
    });
    expect(locked.statusCode).toBe(429);

    // Another caller behind the same proxy keeps its own console budget.
    const other = await app.inject({
      method: "POST",
      url: "/console/login",
      remoteAddress: PROXY,
      headers: { "x-forwarded-for": "198.51.100.61" },
      payload: { username: "test-superuser", password: "wrong" },
    });
    expect(other.statusCode).toBe(401);
  });
});

describe("a peer outside WARD_TRUSTED_PROXIES", () => {
  it("is keyed on itself, whatever it forwards", async () => {
    // Exactly brief 28's outage, reproduced on purpose: an unlisted proxy puts
    // everybody behind it in one bucket.
    for (let caller = 1; caller <= 5; caller += 1) {
      const response = await badLogin(STRANGER, `198.51.100.${caller}`, `user-${caller}`);
      expect(response.statusCode).toBe(401);
    }

    const sixth = await badLogin(STRANGER, "198.51.100.6", "user-6");
    expect(sixth.statusCode).toBe(429);
  });
});
