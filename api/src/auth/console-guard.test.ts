import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { testFastify } from "../testing/fastify.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateSigningKeyFile } from "../tokens/keygen.js";
import { newFamilyId } from "../db/refresh-tokens.js";

/**
 * The console gate, both directions.
 *
 * The Fastify instance here is built by hand rather than through `buildApp()`,
 * deliberately: going through it would couple this suite to every route
 * `buildApp()` registers. A bare instance with one guarded route is also a
 * more honest test of the guard — nothing else in the request lifecycle can be
 * doing the rejecting.
 */

const ORIGIN = "https://gandolh.ro";

let dir: string;
let app: FastifyInstance;
let superuser: typeof import("./superuser.js");
let guard: typeof import("./console-guard.js");
let mintAccessToken: (subject: string, sessionId: string) => Promise<{ token: string }>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-console-guard-"));

  process.env["PORT"] = "8799";
  process.env["HOST"] = "127.0.0.1";
  process.env["WARD_DB_PATH"] = join(dir, "ward.db");
  process.env["WARD_ADMIN_USERNAME"] = "break-glass";
  process.env["WARD_ADMIN_PASSWORD"] = "a-long-random-break-glass-password";
  process.env["WARD_SIGNING_KEY_PATH"] = join(dir, "signing-key.pem");
  process.env["WARD_PUBLIC_ORIGIN"] = ORIGIN;
  // Mail is part of the required environment contract. `file`
  // transport needs no SMTP credentials, which is the point of having a mode.
  process.env["WARD_MAIL_TRANSPORT"] = "file";
  process.env["WARD_MAIL_FILE_DIR"] = "api/mail-outbox";
  process.env["WARD_MAIL_FROM"] = "ward@gandolh.ro";

  const config = await import("../config.js");
  await generateSigningKeyFile(config.WARD_SIGNING_KEY_PATH);

  superuser = await import("./superuser.js");
  guard = await import("./console-guard.js");
  ({ mintAccessToken } = await import("../tokens/service.js"));

  app = await testFastify({ logger: false });
  // Stands in for the admin routes, attached exactly the way they attach.
  app.get("/console/probe", { preHandler: guard.requireConsoleSession }, async (request, reply) => {
    const session = guard.getConsoleSession(request);
    return reply.code(200).send({ reached: true, sessionId: session?.id ?? null });
  });
  app.post("/console/probe", { preValidation: guard.requireConsoleSession }, async (_request, reply) =>
    reply.code(200).send({ reached: true }),
  );
  await app.ready();
});

afterEach(() => {
  vi.useRealTimers();
  superuser.resetConsoleSessionsForTests();
});

afterAll(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

function cookie(value: string): string {
  return `${superuser.CONSOLE_COOKIE_NAME}=${encodeURIComponent(value)}`;
}

describe("the console guard admits a live console session", () => {
  it("runs the route and exposes the session, which has no subject", async () => {
    const { token, session } = superuser.openConsoleSession();

    const response = await app.inject({
      method: "GET",
      url: "/console/probe",
      headers: { cookie: cookie(token) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reached: true, sessionId: session.id });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("slides the idle window on every admitted request", async () => {
    vi.useFakeTimers();
    const { token } = superuser.openConsoleSession();

    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(superuser.CONSOLE_SESSION_IDLE_TIMEOUT_SECONDS * 1000 - 5_000);
      const response = await app.inject({
        method: "GET",
        url: "/console/probe",
        headers: { cookie: cookie(token) },
      });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe("the console guard rejects everything else with one opaque 401", () => {
  /**
   * Collected in one table on purpose. Every one of these must produce a
   * byte-identical response: the caller must not be able to tell whether a
   * console credential exists, whether a session ever existed, or whether one
   * has just timed out.
   */
  it("answers identically to a missing, malformed, unknown and expired cookie", async () => {
    vi.useFakeTimers();
    const { token: expiredToken } = superuser.openConsoleSession();
    vi.advanceTimersByTime(superuser.CONSOLE_SESSION_IDLE_TIMEOUT_SECONDS * 1000 + 1_000);

    const headers = [
      undefined,
      { cookie: "" },
      { cookie: "ward_session=irrelevant" },
      { cookie: cookie("wcs_not-a-real-token") },
      { cookie: "ward_console=%zz" },
      { cookie: cookie(expiredToken) },
    ];

    const responses = await Promise.all(
      headers.map((header) =>
        app.inject({
          method: "GET",
          url: "/console/probe",
          ...(header ? { headers: header } : {}),
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
      expect(response.headers["cache-control"]).toBe("no-store");
      // No native credential prompt, and no scheme to probe.
      expect(response.headers["www-authenticate"]).toBeUndefined();
    }
    // Every body byte-identical, so there is no oracle in the payload either.
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
  });

  it("rejects an ordinary account's access token, in either cookie", async () => {
    /**
     * The first of the two directions the gate must hold. An ordinary account's
     * access token is a real, currently-valid, Ward-signed JWT — and it opens
     * nothing on the console. The superuser gate is not "any authenticated
     * caller"; there is no `ward:admin` grant and no token that substitutes for
     * the break-glass credential.
     *
     * The mirror direction — a console token rejected by the token layer's
     * verify — is asserted in `superuser.test.ts`.
     */
    const { token: accessToken } = await mintAccessToken("f".repeat(32), newFamilyId());
    expect(accessToken.split(".")).toHaveLength(3); // it really is a JWT

    // In the console cookie, where the guard actually looks.
    const asConsole = await app.inject({
      method: "GET",
      url: "/console/probe",
      headers: { cookie: cookie(accessToken) },
    });
    expect(asConsole.statusCode).toBe(401);

    // And in the `Path=/` session cookie, which is where it really lives on this
    // single origin — the guard must not so much as look at it.
    const asSession = await app.inject({
      method: "GET",
      url: "/console/probe",
      headers: { cookie: `ward_session=${accessToken}` },
      // A bearer header too, in case anyone later reaches for one.
    });
    expect(asSession.statusCode).toBe(401);

    const asBearer = await app.inject({
      method: "GET",
      url: "/console/probe",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(asBearer.statusCode).toBe(401);
  });

  it("never runs the guarded handler when it refuses", async () => {
    const response = await app.inject({ method: "GET", url: "/console/probe" });

    expect(response.statusCode).toBe(401);
    // The handler's own marker is absent, so the hook genuinely stopped the
    // lifecycle rather than merely setting a status.
    expect(response.body).not.toContain("reached");
  });

  it("does not attach a session when it refuses", async () => {
    let seen: unknown = "unset";
    const probe = await testFastify({ logger: false });
    probe.get("/console/leak", async (request, reply) => {
      seen = guard.getConsoleSession(request);
      return reply.send({ ok: true });
    });
    probe.addHook("preHandler", guard.requireConsoleSession);
    await probe.ready();

    const response = await probe.inject({ method: "GET", url: "/console/leak" });
    await probe.close();

    expect(response.statusCode).toBe(401);
    expect(seen).toBe("unset");
  });
});

describe("the console guard takes writes only from Ward's own pages", () => {
  const FOREIGN = "https://app.example.test";

  async function post(headers: Record<string, string>, withCookie = true) {
    const { token } = superuser.openConsoleSession();
    return app.inject({
      method: "POST",
      url: "/console/probe",
      headers: { ...headers, ...(withCookie ? { cookie: cookie(token) } : {}) },
      ...(headers["content-type"] === "application/json" ? { payload: "{}" } : {}),
    });
  }

  it("admits the console UI's own request: Ward's origin, same-origin fetch, JSON", async () => {
    const response = await post({
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "content-type": "application/json",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reached: true });
  });

  it("admits a caller that sends neither header, as a script does", async () => {
    expect((await post({})).statusCode).toBe(200);
  });

  it("refuses another origin with 403 cross_site and never runs the handler", async () => {
    const refused: Record<string, string>[] = [
      { origin: FOREIGN, "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors" },
      { origin: FOREIGN, "sec-fetch-site": "cross-site" },
      { origin: FOREIGN },
      { origin: "null" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
      { origin: ORIGIN, "sec-fetch-site": "same-site" },
    ];
    for (const headers of refused) {
      const response = await post(headers);
      expect(response.statusCode, JSON.stringify(headers)).toBe(403);
      expect(response.json()).toEqual({ error: "cross_site" });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("reached");
    }
  });

  it("decides on headers before the cookie, so a signed-out request from another origin is a 403 too", async () => {
    const response = await post({ origin: FOREIGN, "sec-fetch-site": "same-site" }, false);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "cross_site" });
  });

  it("leaves reads alone: a GET from another origin with a live session is admitted", async () => {
    const { token } = superuser.openConsoleSession();
    const response = await app.inject({
      method: "GET",
      url: "/console/probe",
      headers: { cookie: cookie(token), origin: FOREIGN, "sec-fetch-site": "same-site" },
    });
    expect(response.statusCode).toBe(200);
  });
});
