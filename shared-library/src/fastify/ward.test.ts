import Database from "better-sqlite3";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAccounts, seedUsers, type Accounts } from "../core/accounts.js";
import { createSqliteStore } from "../store/sqlite.js";
import {
  Browser,
  WARD_ISSUER,
  WARD_ORIGIN,
  WARD_PREFIX,
  startWard,
  type RealWard,
} from "../testing/ward-harness.js";
import { createWardClient, type WardClient } from "../ward/client.js";
import { WardConfigurationError, WardUnavailableError } from "../ward/errors.js";
import { createWardIdentities, type WardIdentities } from "../ward/identities.js";
import { wardAuth } from "./plugin.js";

/**
 * "Sign in with Ward" end to end: the library's plugin in a test app, against
 * a real Ward built in-process (see `testing/ward-harness.ts`). The browser is
 * simulated with external URLs on both origins and a Path-aware cookie jar per
 * origin, so a cookie scoped where the flow cannot see it breaks the flow here
 * too.
 *
 * The app's clock is injected: the 30-second cache is tested by moving it.
 * Ward runs on the real clock.
 */

const APP_ORIGIN = "http://localhost:5173";
const API_PREFIX = "/myapp-api";
const REDIRECT_URI = `${APP_ORIGIN}${API_PREFIX}/auth/ward/callback`;
const POST_LOGOUT_URI = `${APP_ORIGIN}/myapp/`;
const COOKIE = "myapp_session";
const LOCAL_PASSWORD = "a local password, long enough";

let ward: RealWard;
let clientKey: string;
let clock = Date.now();
const now = () => clock;

interface TestApp {
  app: FastifyInstance;
  accounts: Accounts;
  identities: WardIdentities;
  client: WardClient;
}

let t: TestApp;

async function buildTestApp(key = clientKey): Promise<TestApp> {
  const accounts = createAccounts({ store: createSqliteStore(new Database(":memory:")), now });
  const identities = createWardIdentities({ accounts, now });
  const client = await createWardClient({
    issuer: WARD_ISSUER,
    clientId: "myapp",
    clientKey: key,
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: POST_LOGOUT_URI,
    fetch: ward.wardFetch,
    now,
  });
  const app = Fastify();
  await app.register(wardAuth, {
    accounts,
    cookieName: COOKIE,
    cookiePath: API_PREFIX,
    publicOrigin: APP_ORIGIN,
    routePrefix: "/auth",
    now,
    ward: {
      client,
      identities,
      loginPath: "/myapp/login",
      settingsPath: "/myapp/settings",
      afterSignInPath: "/myapp/",
    },
  });
  app.get("/me", async (request) => ({
    user: request.auth!.user,
    origin: request.auth!.session.origin,
  }));
  await app.ready();
  return { app, accounts, identities, client };
}

function browser(app: TestApp = t): Browser {
  return new Browser(ward, { origin: APP_ORIGIN, apiPrefix: API_PREFIX, app: app.app });
}

const api = (path: string) => `${APP_ORIGIN}${API_PREFIX}${path}`;

/** Press "Sign in with Ward" (or link, or reauthenticate) and follow it home. */
async function wardRoundTrip(
  b: Browser,
  username: string | undefined,
  route: "/auth/ward/start" | "/auth/ward/link" | "/auth/ward/reauthenticate" = "/auth/ward/start",
  body: unknown = {},
): Promise<{ landed: URL; askedForPassword: boolean }> {
  const started = await b.request("POST", api(route), { json: body });
  expect(started.statusCode, started.body).toBe(200);
  const { url } = started.json<{ url: string }>();
  expect(url.startsWith(`${WARD_ISSUER}/auth?`)).toBe(true);
  return b.follow(url, username);
}

async function me(b: Browser): Promise<LightMyRequestResponse> {
  return b.request("GET", api("/me"));
}

async function session(b: Browser): Promise<Record<string, unknown>> {
  return (await b.request("GET", api("/auth/session"))).json();
}

function familyOf(subject: string): string {
  const live = ward.modules.refresh.listLiveTokensForSubject(ward.db, subject);
  expect(live.length).toBeGreaterThan(0);
  return live[live.length - 1]!.family_id;
}

beforeAll(async () => {
  ward = await startWard();
  clientKey = await ward.registerClient({
    slug: "myapp",
    name: "My App",
    redirectUris: [REDIRECT_URI],
    postLogoutRedirectUris: [POST_LOGOUT_URI],
  });
  t = await buildTestApp();
});

afterAll(async () => {
  await t?.app.close();
  await ward?.close();
});

beforeEach(() => {
  ward.start();
  clock += 60 * 60 * 1000; // a fresh 30-second window for every test
});

describe("a first Ward sign-in", () => {
  it("creates a local user linked to the subject, with the grant's role and no password", async () => {
    const subject = await ward.createAccount("alice", "myapp", ["editor"]);
    const b = browser();

    const { landed, askedForPassword } = await wardRoundTrip(b, "alice");
    expect(askedForPassword).toBe(true);
    expect(landed.href).toBe(`${APP_ORIGIN}/myapp/`);

    // The flow cookie was scoped to the callback and is gone; the session
    // cookie is scoped to the API.
    expect(b.cookie(APP_ORIGIN, `${COOKIE}_ward`)).toBeUndefined();
    expect(b.cookie(APP_ORIGIN, COOKIE)?.path).toBe(API_PREFIX);

    const answer = await me(b);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      user: { username: "alice", role: "editor", hasPassword: false },
      origin: "ward",
    });
    const user = await t.identities.findUserBySubject(subject);
    expect(user?.username).toBe("alice");
    expect(await session(b)).toMatchObject({ ward: { enabled: true, linked: true } });
  });

  it("reuses that user on the second sign-in", async () => {
    const subject = await ward.createAccount("bob", "myapp", ["viewer"]);
    const first = browser();
    await wardRoundTrip(first, "bob");
    const id = (await me(first)).json<{ user: { id: string } }>().user.id;

    const second = browser();
    await wardRoundTrip(second, "bob");
    expect((await me(second)).json()).toMatchObject({ user: { id, username: "bob" } });
    expect((await t.identities.findUserBySubject(subject))?.id).toBe(id);
  });

  it("never links a same-named local user: the Ward user gets a suffixed name", async () => {
    await seedUsers(t.accounts, [{ username: "erin", password: LOCAL_PASSWORD, role: "admin" }]);
    const local = (await t.accounts.findUserByUsername("erin"))!;
    const subject = await ward.createAccount("erin", "myapp", ["viewer"]);

    const b = browser();
    await wardRoundTrip(b, "erin");
    const signedIn = (await me(b)).json<{ user: { id: string; username: string; role: string } }>()
      .user;
    expect(signedIn.id).not.toBe(local.id);
    expect(signedIn.username).toBe("erin-2");
    expect(signedIn.role).toBe("viewer");
    expect(await t.identities.subjectOf(local.id)).toBeUndefined();
    expect((await t.identities.findUserBySubject(subject))?.id).toBe(signedIn.id);
  });

  it("lands on the returnTo path the start named, and refuses one that leaves the origin", async () => {
    await ward.createAccount("rita", "myapp", ["viewer"]);
    const b = browser();
    const { landed } = await wardRoundTrip(b, "rita", "/auth/ward/start", {
      returnTo: "/myapp/items/7?tab=notes",
    });
    expect(`${landed.pathname}${landed.search}`).toBe("/myapp/items/7?tab=notes");

    for (const returnTo of ["//evil.example/x", "https://evil.example/", "/\\evil.example"]) {
      const refused = await browser().request("POST", api("/auth/ward/start"), {
        json: { returnTo },
      });
      expect(refused.statusCode, returnTo).toBe(400);
    }
  });
});

describe("Ward's refusals", () => {
  it("sends a person with no grant back to the login page with access_denied", async () => {
    await ward.createAccount("nogrant", "other-app", []);
    const b = browser();
    const { landed } = await wardRoundTrip(b, "nogrant");
    expect(landed.pathname).toBe("/myapp/login");
    expect(landed.searchParams.get("ward_error")).toBe("access_denied");
    expect(b.cookie(APP_ORIGIN, COOKIE)).toBeUndefined();
  });

  it("sends a person who pressed 'Back to the app' back the same way", async () => {
    const b = browser();
    const started = await b.request("POST", api("/auth/ward/start"), { json: {} });
    const authorize = await b.request("GET", started.json<{ url: string }>().url);
    const interaction = new URL(String(authorize.headers.location), WARD_ORIGIN).href;
    const { landed } = await b.follow(`${interaction}/abort`);
    expect(landed.searchParams.get("ward_error")).toBe("access_denied");
  });

  it("refuses a callback with no flow cookie as invalid_callback", async () => {
    const response = await browser().request("GET", api("/auth/ward/callback?code=x&state=y"));
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`${APP_ORIGIN}/myapp/login?ward_error=invalid_callback`);
  });
});

describe("the 30-second check", () => {
  it("ends the app session on the first request after the cache expires once Ward revokes", async () => {
    const subject = await ward.createAccount("carol", "myapp", ["editor"]);
    const b = browser();
    await wardRoundTrip(b, "carol");
    expect((await me(b)).statusCode).toBe(200);

    ward.modules.refresh.revokeFamily(ward.db, familyOf(subject), "admin");

    // Inside the 30 seconds the cached answer stands.
    clock += 29_000;
    expect((await me(b)).statusCode).toBe(200);

    clock += 1_001;
    const refused = await me(b);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: "unauthorized", reason: "ward_session_ended" });
    // The session ended here too: the cookie is cleared and stays dead.
    expect(b.cookie(APP_ORIGIN, COOKIE)).toBeUndefined();
  });

  it("collapses concurrent checks into one request to Ward", async () => {
    const subject = await ward.createAccount("dora", "myapp", ["editor"]);
    const b = browser();
    await wardRoundTrip(b, "dora");
    clock += 31_000;

    const before = ward.calls.filter((path) => path === "/session-status").length;
    const answers = await Promise.all([me(b), me(b), me(b), me(b), me(b)]);
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const after = ward.calls.filter((path) => path === "/session-status").length;
    expect(after - before).toBe(1);
    expect(familyOf(subject)).toBeTypeOf("string");
  });

  it("with Ward stopped, refuses a Ward session as ward_unavailable and keeps a local one", async () => {
    await ward.createAccount("frank", "myapp", ["editor"]);
    await seedUsers(t.accounts, [{ username: "gina", password: LOCAL_PASSWORD, role: "admin" }]);

    const viaWard = browser();
    await wardRoundTrip(viaWard, "frank");
    const local = browser();
    const login = await local.request("POST", api("/auth/login"), {
      json: { username: "gina", password: LOCAL_PASSWORD },
    });
    expect(login.statusCode).toBe(200);

    ward.stop();
    clock += 31_000;
    const callsBefore = ward.calls.length;

    const refused = await me(viaWard);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: "unauthorized", reason: "ward_unavailable" });
    expect(await session(viaWard)).toMatchObject({ user: null, reason: "ward_unavailable" });

    const ok = await me(local);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ user: { username: "gina" }, origin: "local" });

    // The Ward session was refused, not ended: it works again when Ward is back.
    ward.start();
    expect((await me(viaWard)).statusCode).toBe(200);
    // Only the Ward session ever asked; the local one never did.
    expect(ward.calls.slice(callsBefore).every((path) => path === "/session-status")).toBe(true);
  });

  it("never calls Ward for a local session", async () => {
    await seedUsers(t.accounts, [{ username: "hank", password: LOCAL_PASSWORD, role: "admin" }]);
    const b = browser();
    await b.request("POST", api("/auth/login"), {
      json: { username: "hank", password: LOCAL_PASSWORD },
    });
    const before = ward.calls.length;
    for (let i = 0; i < 3; i += 1) {
      clock += 31_000;
      expect((await me(b)).statusCode).toBe(200);
    }
    expect(ward.calls.length).toBe(before);
  });

  it("names the client configuration when Ward refuses the credential (401)", async () => {
    const subject = await ward.createAccount("ivan", "myapp", ["editor"]);
    const b = browser();
    await wardRoundTrip(b, "ivan");

    const otherKey = (await ward.modules.keygen.generateClientKeyPair()).envValue;
    const misconfigured = await createWardClient({
      issuer: WARD_ISSUER,
      clientId: "myapp",
      clientKey: otherKey,
      redirectUri: REDIRECT_URI,
      fetch: ward.wardFetch,
    });
    const error = await misconfigured.checkSession(familyOf(subject), subject).catch((e) => e);
    expect(error).toBeInstanceOf(WardConfigurationError);
    expect(error).toBeInstanceOf(WardUnavailableError);
    expect(String(error.message)).toMatch(/WARD_OIDC_CLIENT_KEY/);
  });
});

describe("linking from settings", () => {
  it("links the signed-in local user, who then signs in with Ward as themselves", async () => {
    await seedUsers(t.accounts, [{ username: "judy", password: LOCAL_PASSWORD, role: "admin" }]);
    const local = (await t.accounts.findUserByUsername("judy"))!;
    const subject = await ward.createAccount("judy-at-ward", "myapp", ["viewer"]);

    const b = browser();
    await b.request("POST", api("/auth/login"), {
      json: { username: "judy", password: LOCAL_PASSWORD },
    });
    const { landed } = await wardRoundTrip(b, "judy-at-ward", "/auth/ward/link");
    expect(landed.pathname).toBe("/myapp/settings");
    expect(landed.searchParams.get("ward")).toBe("linked");
    expect(await t.identities.subjectOf(local.id)).toBe(subject);
    expect(await session(b)).toMatchObject({ user: { id: local.id }, ward: { linked: true } });

    // The local session carried on; a later Ward sign-in is the same user,
    // keeping the local role (the app's row owns it).
    const other = browser();
    await wardRoundTrip(other, "judy-at-ward");
    expect((await me(other)).json()).toMatchObject({
      user: { id: local.id, username: "judy", role: "admin" },
      origin: "ward",
    });
  });

  it("refuses a Ward account already linked to someone else", async () => {
    await ward.createAccount("kate", "myapp", ["viewer"]);
    await wardRoundTrip(browser(), "kate"); // creates and links a user "kate"

    await seedUsers(t.accounts, [{ username: "kate-local", password: LOCAL_PASSWORD, role: "a" }]);
    const b = browser();
    await b.request("POST", api("/auth/login"), {
      json: { username: "kate-local", password: LOCAL_PASSWORD },
    });
    const { landed } = await wardRoundTrip(b, "kate", "/auth/ward/link");
    expect(landed.searchParams.get("ward_error")).toBe("ward_account_in_use");
  });

  it("finishes a link only for the session that started it", async () => {
    await seedUsers(t.accounts, [
      { username: "mallory", password: LOCAL_PASSWORD, role: "admin" },
      { username: "victim", password: LOCAL_PASSWORD, role: "admin" },
    ]);
    await ward.createAccount("victim-at-ward", "myapp", ["viewer"]);

    // The attacker starts a link on their own account…
    const attacker = browser();
    await attacker.request("POST", api("/auth/login"), {
      json: { username: "mallory", password: LOCAL_PASSWORD },
    });
    const started = await attacker.request("POST", api("/auth/ward/link"), { json: {} });
    const flowCookie = attacker.cookie(APP_ORIGIN, `${COOKIE}_ward`)!;
    expect(flowCookie.path).toBe(`${API_PREFIX}/auth/ward/callback`);

    // …and gets the victim's browser, signed in as the victim, to finish it.
    const victim = browser();
    await victim.request("POST", api("/auth/login"), {
      json: { username: "victim", password: LOCAL_PASSWORD },
    });
    const authorize = await victim.request("GET", started.json<{ url: string }>().url);
    const toCallback = await victim
      .follow(new URL(String(authorize.headers.location), WARD_ORIGIN).href, "victim-at-ward")
      .catch(() => undefined);
    // Without the attacker's flow cookie the callback is refused outright.
    expect(toCallback?.landed.searchParams.get("ward_error")).toBe("invalid_callback");

    // With it planted, the session check refuses it.
    const planted = browser();
    await planted.request("POST", api("/auth/login"), {
      json: { username: "victim", password: LOCAL_PASSWORD },
    });
    const restarted = await attacker.request("POST", api("/auth/ward/link"), { json: {} });
    const attackerFlow = attacker.cookie(APP_ORIGIN, `${COOKIE}_ward`)!;
    const victimSession = planted.cookie(APP_ORIGIN, COOKIE)!;
    const authorized = await planted.request("GET", restarted.json<{ url: string }>().url);
    let next = new URL(String(authorized.headers.location), WARD_ORIGIN).href;
    // Walk Ward's side by hand, then present the callback with both cookies.
    for (let hop = 0; hop < 10; hop += 1) {
      const at = new URL(next);
      if (at.origin === APP_ORIGIN) break;
      if (at.pathname === "/ward/login") {
        await planted.signInAtWard("victim-at-ward");
        next = `${WARD_ORIGIN}${WARD_PREFIX}/refresh/oidc/${at.searchParams.get("oidc")}`;
        continue;
      }
      const response = await planted.request("GET", next);
      next = new URL(String(response.headers.location), next).href;
    }
    expect(next.startsWith(REDIRECT_URI)).toBe(true);
    const callbackPath = new URL(next);
    const finished = await t.app.inject({
      method: "GET",
      url: `${callbackPath.pathname.slice(API_PREFIX.length)}${callbackPath.search}`,
      headers: {
        cookie: `${COOKIE}_ward=${attackerFlow.value}; ${COOKIE}=${victimSession.value}`,
      },
    });
    expect(finished.statusCode).toBe(303);
    expect(finished.headers.location).toBe(`${APP_ORIGIN}/myapp/settings?ward_error=unauthorized`);
    const mallory = (await t.accounts.findUserByUsername("mallory"))!;
    const victimUser = (await t.accounts.findUserByUsername("victim"))!;
    expect(await t.identities.subjectOf(mallory.id)).toBeUndefined();
    expect(await t.identities.subjectOf(victimUser.id)).toBeUndefined();
  });
});

describe("settings: local password and unlink", () => {
  it("refuses to unlink a user with no local password", async () => {
    await ward.createAccount("liam", "myapp", ["viewer"]);
    const b = browser();
    await wardRoundTrip(b, "liam");
    const refused = await b.request("POST", api("/auth/ward/unlink"), { json: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "no_local_password" });
    expect(await session(b)).toMatchObject({ ward: { linked: true } });
  });

  it("sets a first local password only after a fresh Ward sign-in, then allows unlinking", async () => {
    await ward.createAccount("mia", "myapp", ["viewer"]);
    const b = browser();
    await wardRoundTrip(b, "mia");

    // Ten minutes on, the Ward sign-in is no longer fresh.
    clock += 11 * 60 * 1000;
    const stale = await b.request("POST", api("/auth/ward/set-password"), {
      json: { newPassword: LOCAL_PASSWORD },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toEqual({ error: "reauthentication_required" });

    // Reauthenticate: Ward asks for the password again, even with its session
    // live. Its sign-in must predate the authorization by more than the
    // provider's one-second resolution, as it would in life.
    ward.db.exec(
      "UPDATE refresh_tokens SET issued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds')",
    );
    const { landed, askedForPassword } = await wardRoundTrip(b, "mia", "/auth/ward/reauthenticate");
    expect(askedForPassword).toBe(true);
    expect(landed.searchParams.get("ward")).toBe("reauthenticated");

    const set = await b.request("POST", api("/auth/ward/set-password"), {
      json: { newPassword: LOCAL_PASSWORD },
    });
    expect(set.statusCode, set.body).toBe(204);
    expect(await session(b)).toMatchObject({ user: { hasPassword: true } });

    // Now a password change needs the current one.
    const missing = await b.request("POST", api("/auth/ward/set-password"), {
      json: { newPassword: "another long password" },
    });
    expect(missing.statusCode).toBe(400);

    // And unlinking is allowed; this session began with Ward, so it ends.
    const unlinked = await b.request("POST", api("/auth/ward/unlink"), { json: {} });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toEqual({ signedOut: true });
    expect((await me(b)).statusCode).toBe(401);

    const login = await browser().request("POST", api("/auth/login"), {
      json: { username: "mia", password: LOCAL_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ ward: { enabled: true, linked: false } });
  });
});

describe("sign out of Ward too", () => {
  it("ends the session here and answers Ward's end-session URL, which revokes the Ward session", async () => {
    const subject = await ward.createAccount("nora", "myapp", ["viewer"]);
    const b = browser();
    await wardRoundTrip(b, "nora");
    const family = familyOf(subject);

    const out = await b.request("POST", api("/auth/ward/logout"), { json: {} });
    expect(out.statusCode, out.body).toBe(200);
    const { url } = out.json<{ url: string }>();
    expect(url.startsWith(`${WARD_ISSUER}/session/end?`)).toBe(true);
    expect(new URL(url).searchParams.get("post_logout_redirect_uri")).toBe(POST_LOGOUT_URI);
    expect((await me(b)).statusCode).toBe(401);

    const end = await b.request("GET", url);
    expect(end.statusCode, end.body).toBe(200);
    expect(ward.modules.resolve.hasLiveFamily(ward.db, family, subject)).toBe(false);
  });

  it("is a plain sign-out for a local session", async () => {
    await seedUsers(t.accounts, [{ username: "omar", password: LOCAL_PASSWORD, role: "admin" }]);
    const b = browser();
    await b.request("POST", api("/auth/login"), {
      json: { username: "omar", password: LOCAL_PASSWORD },
    });
    const out = await b.request("POST", api("/auth/ward/logout"), { json: {} });
    expect(out.json()).toEqual({ url: null });
    expect((await me(b)).statusCode).toBe(401);
  });
});

describe("mail", () => {
  it("reaches a linked user through Ward, and never calls Ward for an unlinked one", async () => {
    await ward.createAccount("pia", "myapp", ["viewer"]);
    const b = browser();
    await wardRoundTrip(b, "pia");
    const user = (await t.accounts.findUserByUsername("pia"))!;
    expect(
      await t.identities.notifyUser(t.client, user.id, { mailSubject: "Hi", text: "Hello." }),
    ).toEqual({ sent: true });

    await seedUsers(t.accounts, [{ username: "quinn", password: LOCAL_PASSWORD, role: "a" }]);
    const quinn = (await t.accounts.findUserByUsername("quinn"))!;
    const before = ward.calls.length;
    expect(
      await t.identities.notifyUser(t.client, quinn.id, { mailSubject: "Hi", text: "Hello." }),
    ).toEqual({ sent: false, reason: "not_linked" });
    expect(ward.calls.length).toBe(before);

    ward.stop();
    await expect(
      t.identities.notifyUser(t.client, user.id, { mailSubject: "Hi", text: "Hello." }),
    ).rejects.toBeInstanceOf(WardUnavailableError);
  });
});

describe("Ward down", () => {
  it("lets the app boot, and answers the button with ward_unavailable until Ward is back", async () => {
    ward.stop();
    const fresh = await buildTestApp();
    try {
      const b = browser(fresh);
      const refused = await b.request("POST", api("/auth/ward/start"), { json: {} });
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toEqual({ error: "ward_unavailable" });

      // Discovery failing is not cached.
      ward.start();
      const started = await b.request("POST", api("/auth/ward/start"), { json: {} });
      expect(started.statusCode).toBe(200);
    } finally {
      await fresh.app.close();
    }
  });

  it("sends a sign-in whose code exchange cannot reach Ward back with ward_unavailable", async () => {
    await ward.createAccount("ruth", "myapp", ["viewer"]);
    const b = browser();
    const started = await b.request("POST", api("/auth/ward/start"), { json: {} });
    // Walk Ward's side, then stop Ward before the app redeems the code.
    let next = started.json<{ url: string }>().url;
    for (let hop = 0; hop < 10; hop += 1) {
      const at = new URL(next);
      if (at.origin === APP_ORIGIN) break;
      if (at.pathname === "/ward/login") {
        await b.signInAtWard("ruth");
        next = `${WARD_ORIGIN}${WARD_PREFIX}/refresh/oidc/${at.searchParams.get("oidc")}`;
        continue;
      }
      const response = await b.request("GET", next);
      next = new URL(String(response.headers.location), next).href;
    }
    ward.stop();
    const callback = await b.request("GET", next);
    expect(callback.statusCode).toBe(303);
    // Discovery is cached by now, so this is the token request failing.
    expect(callback.headers.location).toBe(`${APP_ORIGIN}/myapp/login?ward_error=ward_unavailable`);
  });

  it("names a refused client credential at the code exchange as ward_misconfigured", async () => {
    await ward.createAccount("sam", "myapp", ["viewer"]);
    const wrongKey = (await ward.modules.keygen.generateClientKeyPair()).envValue;
    const misconfigured = await buildTestApp(wrongKey);
    try {
      const { landed } = await wardRoundTrip(browser(misconfigured), "sam");
      expect(landed.searchParams.get("ward_error")).toBe("ward_misconfigured");
    } finally {
      await misconfigured.app.close();
    }
  });
});
