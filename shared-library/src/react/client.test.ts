import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { configureAuth, createAuthClient } from "./client.js";
import { useChangePassword, useLogin, useLogout, useRegister, useSession } from "./hooks.js";

/**
 * The browser client the hooks wrap, driven with a fake `fetch` in Node. There
 * is no DOM here (see vitest.config.ts); the hooks get one render check below,
 * and their logic lives in the client so this is where it is tested.
 */

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const alice = { id: "u1", username: "alice", role: "admin", hasPassword: true };
const session = { origin: "local", expiresAt: 1 };

describe("createAuthClient", () => {
  it("starts loading, then reports signed out from a 200 with no user", async () => {
    const fetch = vi.fn(async () => json(200, { user: null, session: null }));
    const client = createAuthClient({ basePath: "/demo/api/auth/", fetch });

    expect(client.getState()).toEqual({ status: "loading" });
    await client.refresh();
    expect(client.getState()).toEqual({ status: "signed_out" });
    expect(fetch).toHaveBeenCalledWith(
      "/demo/api/auth/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("carries a refusal reason through to the state", async () => {
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(200, { user: null, session: null, reason: "ward_unavailable" }),
    });
    await client.refresh();
    expect(client.getState()).toEqual({ status: "signed_out", reason: "ward_unavailable" });
  });

  it("collapses concurrent refreshes into one request, and loads once on demand", async () => {
    const fetch = vi.fn(async () => json(200, { user: alice, session }));
    const client = createAuthClient({ basePath: "/a", fetch });

    client.ensureLoaded();
    client.ensureLoaded();
    await Promise.all([client.refresh(), client.refresh()]);
    expect(fetch).toHaveBeenCalledTimes(1);

    client.ensureLoaded();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("signs in: posts JSON, and every subscriber sees the new state", async () => {
    const fetch = vi.fn(async () => json(200, { user: alice, session }));
    const client = createAuthClient({ basePath: "/a", fetch });
    const listener = vi.fn();
    client.subscribe(listener);

    expect(await client.login("alice", "correct horse")).toEqual({ ok: true });
    expect(client.getState()).toEqual({ status: "signed_in", user: alice, session });
    expect(listener).toHaveBeenCalled();

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/a/login");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      username: "alice",
      password: "correct horse",
    });
  });

  it("exposes the server's error code and the lockout's retry-after", async () => {
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(429, { error: "too_many_attempts", retryAfterSeconds: 900 }),
    });
    expect(await client.login("alice", "x")).toEqual({
      ok: false,
      error: { code: "too_many_attempts", status: 429, retryAfterSeconds: 900 },
    });
  });

  it("reports a network failure as its own code", async () => {
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await client.login("alice", "x")).toEqual({ ok: false, error: { code: "network" } });
    await client.refresh();
    expect(client.getState()).toEqual({ status: "error", error: { code: "network" } });
  });

  it("logs out with no body, which Fastify would refuse as empty JSON", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createAuthClient({ basePath: "/a", fetch });

    expect(await client.logout()).toEqual({ ok: true });
    expect(client.getState()).toEqual({ status: "signed_out" });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("marks the state signed out when a password change finds the session gone", async () => {
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(401, { error: "unauthorized" }),
    });
    expect(await client.changePassword("a", "b")).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(client.getState()).toEqual({ status: "signed_out" });
  });

  it("registers, and signs the new user in", async () => {
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(201, { user: alice, session }),
    });
    expect(await client.register("alice", "long enough")).toEqual({ ok: true });
    expect(client.getState()).toMatchObject({ status: "signed_in" });
  });
});

describe("the hooks", () => {
  it("render nothing of their own and start in the loading state", () => {
    configureAuth({ basePath: "/a", fetch: async () => json(200, { user: null, session: null }) });

    let seen: unknown;
    function Probe() {
      const sessionState = useSession();
      const login = useLogin();
      useLogout();
      useChangePassword();
      useRegister();
      seen = { status: sessionState.status, pending: login.pending, error: login.error };
      return null;
    }

    expect(renderToString(createElement(Probe))).toBe("");
    expect(seen).toEqual({ status: "loading", pending: false, error: null });
  });
});
