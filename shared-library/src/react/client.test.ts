import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { configureAuth, createAuthClient, readWardResult } from "./client.js";
import {
  useChangePassword,
  useLogin,
  useLogout,
  useRegister,
  useSession,
  useSetLocalPassword,
  useWardLink,
  useWardSignIn,
  useWardSignOut,
  useWardUnlink,
} from "./hooks.js";

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
/** What a server without Ward configured (or an older one) implies. */
const noWard = { enabled: false, linked: false };

describe("createAuthClient", () => {
  it("starts loading, then reports signed out from a 200 with no user", async () => {
    const fetch = vi.fn(async () => json(200, { user: null, session: null }));
    const client = createAuthClient({ basePath: "/demo/api/auth/", fetch });

    expect(client.getState()).toEqual({ status: "loading" });
    await client.refresh();
    expect(client.getState()).toEqual({ status: "signed_out", ward: noWard });
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
    expect(client.getState()).toEqual({
      status: "signed_out",
      reason: "ward_unavailable",
      ward: noWard,
    });
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
    expect(client.getState()).toEqual({ status: "signed_in", user: alice, session, ward: noWard });
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
    expect(client.getState()).toEqual({ status: "signed_out", ward: noWard });
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
    expect(client.getState()).toEqual({ status: "signed_out", ward: noWard });
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

describe("Sign in with Ward, in the browser", () => {
  const wardOn = { enabled: true, linked: false };

  it("asks the server for Ward's URL and navigates there", async () => {
    const navigate = vi.fn();
    const fetch = vi.fn(async () =>
      json(200, { url: "https://example.com/ward-api/oidc/auth?x=1" }),
    );
    const client = createAuthClient({ basePath: "/a", fetch, navigate });

    expect(await client.startWardSignIn({ returnTo: "/myapp/items/7" })).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith("https://example.com/ward-api/oidc/auth?x=1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/a/ward/start");
    expect(JSON.parse(String(init.body))).toEqual({ returnTo: "/myapp/items/7" });
  });

  it("stays on the page with the error when Ward is unreachable", async () => {
    const navigate = vi.fn();
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(503, { error: "ward_unavailable" }),
      navigate,
    });
    expect(await client.startWardSignIn()).toEqual({
      ok: false,
      error: { code: "ward_unavailable", status: 503 },
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads ?ward_error= and ?ward= once, and takes them out of the address bar", () => {
    const replace = vi.fn();
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(200, {}),
      location: {
        href: "https://example.com/myapp/login?next=%2Fx&ward_error=access_denied",
        replace,
      },
    });
    expect(client.getWardResult()).toEqual({ error: { code: "access_denied" } });
    expect(replace).toHaveBeenCalledWith("https://example.com/myapp/login?next=%2Fx");
    client.clearWardResult();
    expect(client.getWardResult()).toEqual({});

    expect(readWardResult("https://example.com/myapp/settings?ward=linked").result).toEqual({
      result: "linked",
    });
    expect(readWardResult("https://example.com/myapp/").cleaned).toBeUndefined();
    // Only a code-shaped value is believed.
    expect(readWardResult("https://example.com/?ward_error=%3Cscript%3E").result).toEqual({});
  });

  it("unlinks, and is signed out when the session began with Ward", async () => {
    const responses = [
      json(200, {
        user: alice,
        session: { origin: "ward", expiresAt: 1 },
        ward: { ...wardOn, linked: true },
      }),
      json(200, { signedOut: true }),
    ];
    const client = createAuthClient({ basePath: "/a", fetch: async () => responses.shift()! });
    await client.refresh();
    expect(await client.unlinkWard()).toEqual({ ok: true });
    expect(client.getState()).toEqual({ status: "signed_out", ward: wardOn });
  });

  it("sets a local password and refreshes, or reports reauthentication_required", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/session")
        ? json(200, { user: { ...alice, hasPassword: true }, session, ward: wardOn })
        : json(204, undefined),
    );
    const client = createAuthClient({ basePath: "/a", fetch });
    expect(await client.setLocalPassword("a long new password")).toEqual({ ok: true });
    expect(client.getState()).toMatchObject({ status: "signed_in", user: { hasPassword: true } });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ newPassword: "a long new password" });

    const refusing = createAuthClient({
      basePath: "/a",
      fetch: async () => json(403, { error: "reauthentication_required" }),
    });
    expect(await refusing.setLocalPassword("a long new password")).toEqual({
      ok: false,
      error: { code: "reauthentication_required", status: 403 },
    });
  });

  it("signs out of Ward too: signed out here, then off to Ward's end-session page", async () => {
    const navigate = vi.fn();
    const client = createAuthClient({
      basePath: "/a",
      fetch: async () => json(200, { url: "https://example.com/ward-api/oidc/session/end?x" }),
      navigate,
    });
    expect(await client.signOutOfWard()).toEqual({ ok: true });
    expect(client.getState()).toMatchObject({ status: "signed_out" });
    expect(navigate).toHaveBeenCalledWith("https://example.com/ward-api/oidc/session/end?x");

    const local = createAuthClient({
      basePath: "/a",
      fetch: async () => json(200, { url: null }),
      navigate,
    });
    await local.signOutOfWard();
    expect(navigate).toHaveBeenCalledTimes(1);
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
      useWardLink();
      useWardUnlink();
      useSetLocalPassword();
      useWardSignOut();
      const ward = useWardSignIn();
      seen = {
        status: sessionState.status,
        pending: login.pending,
        error: login.error,
        wardError: ward.error,
      };
      return null;
    }

    expect(renderToString(createElement(Probe))).toBe("");
    expect(seen).toEqual({ status: "loading", pending: false, error: null, wardError: null });
  });
});
