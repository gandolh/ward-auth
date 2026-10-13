import * as oidc from "openid-client";

import { WardConfigurationError, WardSignInError, WardUnavailableError } from "./errors.js";
import {
  CLIENT_ASSERTION_TYPE,
  importClientKey,
  signClientAssertion,
  type ClientKey,
} from "./key.js";

/**
 * Talking to Ward: "Sign in with Ward", the 30-second check, mail, and
 * "sign out of Ward too". Framework-free; the Fastify plugin is the only
 * caller in the library, and an app calls `sendNotification` itself.
 *
 * ## Configuration, and nothing assumed about where Ward lives
 *
 * Four values, all from the app's environment (`wardClientOptionsFromEnv`
 * reads them): the issuer, the client id, the client's private key and the
 * redirect URI. Every Ward URL is derived from the issuer — discovery for the
 * OAuth endpoints, and `<issuer minus /oidc>/session-status` and `/notify` for
 * Ward's own — so nothing here assumes Ward shares the app's origin. Locally
 * it does not: Ward runs on its own port, which exercises the cross-origin
 * case on every dev run (decisions-oidc.md).
 *
 * ## Discovery happens once, lazily
 *
 * The provider's metadata is fetched on first use and cached for the life of
 * the process. **Not at boot**: an app must start, and its local sign-in must
 * work, while Ward is down. A failed discovery is not cached, so the next
 * attempt tries again.
 *
 * ## `openid-client`, bundled
 *
 * The code flow is `openid-client` (panva), not hand-written: PKCE, `state`,
 * `nonce`, the `iss` response parameter, client authentication and ID token
 * validation are exactly the code that should come from a certified library.
 * Two settings matter and both are fixed here, not options:
 *
 * - `id_token_signed_response_alg: "EdDSA"` pins the ID token's algorithm.
 *   Without it `openid-client` expects RS256 and rejects every token Ward
 *   signs; with it, a token in any other algorithm is refused.
 * - Non-repudiation checks are on, so the ID token's signature is verified
 *   against Ward's published keys and not only trusted because it arrived over
 *   the authenticated token request.
 */

/** Answers are cached this long per Ward session: the revoke-everywhere bound. */
export const SESSION_STATUS_CACHE_SECONDS = 30;

/** Default timeout for discovery, the code exchange and the session check. */
export const DEFAULT_WARD_TIMEOUT_MS = 5_000;

/** Default timeout for `/notify`: Ward answers after its mail transport accepts. */
export const DEFAULT_NOTIFY_TIMEOUT_MS = 15_000;

export interface WardClientOptions {
  /**
   * `WARD_OIDC_ISSUER`: Ward's issuer, external, ending in `/oidc`, e.g.
   * `https://example.com/ward-api/oidc`. `http:` only on loopback.
   */
  issuer: string;
  /** `WARD_OIDC_CLIENT_ID`: the app's slug at Ward. */
  clientId: string;
  /** `WARD_OIDC_CLIENT_KEY`: base64url of the private JWK. A secret. */
  clientKey: string;
  /**
   * `WARD_OIDC_REDIRECT_URI`: the callback **as the browser sees it**,
   * registered at Ward exactly. It must be the plugin's
   * `<routePrefix>/ward/callback`, served under the app's API prefix (see the
   * adoption guide), e.g. `https://example.com/myapp-api/auth/ward/callback`.
   */
  redirectUri: string;
  /**
   * `WARD_OIDC_POST_LOGOUT_REDIRECT_URI`: where Ward sends the browser after
   * "sign out of Ward too". Must be registered at Ward. Omitted, Ward shows
   * its own signed-out page.
   */
  postLogoutRedirectUri?: string;
  /** For tests; the global `fetch` otherwise. Used for every request to Ward. */
  fetch?: typeof fetch;
  /** Discovery, code exchange and session check. Default 5 s. */
  timeoutMs?: number;
  /** `/notify`. Default 15 s. */
  notifyTimeoutMs?: number;
  /** Epoch milliseconds, for the session-check cache only. Injected by tests. */
  now?: () => number;
}

/** Who Ward says signed in, from a verified ID token. */
export interface WardIdentity {
  /** `sub`: Ward's stable subject. The only thing a local user is linked by. */
  subject: string;
  /** `preferred_username`: a suggestion for a new user's name, never a key. */
  username: string;
  /** `ward_role`: the role the grant names, for a user created by this sign-in. */
  role: string;
  /** `ward_sid`: Ward's refresh family, what the 30-second check asks about. */
  wardSid: string;
  /** The raw ID token, kept as the `id_token_hint` for "sign out of Ward too". */
  idToken: string;
}

/** The secrets one authorization round trip carries in the flow cookie. */
export interface WardFlowSecrets {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export type WardSessionStatus = { active: true; role: string } | { active: false };

export interface WardNotification {
  /** The recipient's **Ward subject**. Only linked users have one. */
  subject: string;
  /** One line, at most 200 characters. Ward prefixes the app's name. */
  mailSubject: string;
  /** Plain text, at most 20,000 characters. Ward appends a footer. */
  text: string;
}

export interface WardClient {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /**
   * The authorization URL to send the browser to, and the secrets to keep
   * for the callback. `prompt: "login"` makes Ward ask for the password even
   * with a live Ward session (a fresh sign-in). Throws `WardUnavailableError`.
   */
  startAuthorization(options?: { prompt?: "login" }): Promise<{
    url: string;
    flow: WardFlowSecrets;
  }>;
  /**
   * Finish the round trip: check the response against the flow, exchange the
   * code with client authentication, verify the ID token. `search` is the
   * callback's query string. Throws `WardSignInError` with a stable `code`.
   */
  finishAuthorization(search: string, flow: WardFlowSecrets): Promise<WardIdentity>;
  /**
   * Is this Ward session live, and the grant still held? Cached 30 s per
   * session, concurrent calls collapsed into one request. Throws
   * `WardUnavailableError` (or its `WardConfigurationError`) for anything but
   * a well-formed `200`: the caller fails closed.
   */
  checkSession(wardSid: string, subject: string): Promise<WardSessionStatus>;
  /**
   * Ask Ward to mail a linked user. `{ sent: false }` is Ward's refusal, which
   * does not say why. Throws `WardUnavailableError` on a transport failure or
   * Ward's `503 mail_unavailable`, `WardConfigurationError` on a `401`.
   */
  sendNotification(input: WardNotification): Promise<{ sent: boolean }>;
  /**
   * Ward's end-session URL for "sign out of Ward too". Ward revokes the
   * session the hint's `ward_sid` names. Throws `WardUnavailableError` when
   * discovery fails.
   */
  endSessionUrl(idTokenHint: string, state?: string): Promise<string>;
}

/**
 * Build a client. Validates the configuration and imports the key now, so a
 * bad value fails at boot; talks to Ward only on first use.
 */
export async function createWardClient(options: WardClientOptions): Promise<WardClient> {
  const issuer = parseHttpUrl(options.issuer, "issuer");
  if (!issuer.pathname.endsWith("/oidc")) {
    throw new TypeError(`ward: issuer must end in /oidc, got ${JSON.stringify(options.issuer)}`);
  }
  const insecure = issuer.protocol === "http:";
  if (insecure && !isLoopback(issuer.hostname)) {
    throw new TypeError("ward: issuer must be https, except on loopback for local development");
  }
  const redirectUri = parseHttpUrl(options.redirectUri, "redirectUri").href;
  const postLogoutRedirectUri =
    options.postLogoutRedirectUri === undefined || options.postLogoutRedirectUri === ""
      ? undefined
      : parseHttpUrl(options.postLogoutRedirectUri, "postLogoutRedirectUri").href;
  if (typeof options.clientId !== "string" || options.clientId.length === 0) {
    throw new TypeError("ward: clientId is required");
  }

  const clientId = options.clientId;
  const issuerString = issuer.href.replace(/\/$/, "");
  const wardApi = issuerString.slice(0, -"/oidc".length);
  const sessionStatusUrl = `${wardApi}/session-status`;
  const notifyUrl = `${wardApi}/notify`;
  const key: ClientKey = await importClientKey(options.clientKey);
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_WARD_TIMEOUT_MS;
  const notifyTimeoutMs = options.notifyTimeoutMs ?? DEFAULT_NOTIFY_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  // -------------------------------------------------------------------------
  // Discovery, once
  // -------------------------------------------------------------------------

  let configuration: Promise<oidc.Configuration> | undefined;

  function discover(): Promise<oidc.Configuration> {
    if (configuration !== undefined) return configuration;
    const attempt = oidc
      .discovery(
        new URL(issuerString),
        clientId,
        { id_token_signed_response_alg: "EdDSA" },
        oidc.PrivateKeyJwt({ key: key.privateKey, kid: key.kid }),
        {
          // Plain HTTP is allowed only for a loopback issuer, checked above.
          execute: insecure ? [oidc.allowInsecureRequests] : [],
          [oidc.customFetch]: fetchImpl,
          timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        },
      )
      .then((config) => {
        oidc.enableNonRepudiationChecks(config);
        return config;
      })
      .catch((error: unknown) => {
        // Not cached: the next request tries again.
        if (configuration === attempt) configuration = undefined;
        throw discoveryError(error);
      });
    configuration = attempt;
    return attempt;
  }

  // -------------------------------------------------------------------------
  // The 30-second check
  // -------------------------------------------------------------------------

  const statusCache = new Map<string, { status: WardSessionStatus; expiresAt: number }>();
  const statusInflight = new Map<string, Promise<WardSessionStatus>>();

  async function askSessionStatus(wardSid: string, subject: string): Promise<WardSessionStatus> {
    const body = JSON.stringify({
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: await signClientAssertion(key, clientId, issuerString),
      wardSid,
      subject,
    });
    const response = await post(sessionStatusUrl, body, timeoutMs, "session-status");
    if (response.status === 401) throw configurationError("session-status");
    if (response.status !== 200) {
      throw new WardUnavailableError(`session-status answered ${response.status}`);
    }

    const answer = await readJson(response, "session-status");
    if (answer.active === false) return { active: false };
    if (answer.active === true && typeof answer.role === "string") {
      return { active: true, role: answer.role };
    }
    throw new WardUnavailableError("session-status answered a body outside its contract");
  }

  function checkSession(wardSid: string, subject: string): Promise<WardSessionStatus> {
    const cacheKey = `${wardSid}\u0000${subject}`;
    const cached = statusCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > now()) return Promise.resolve(cached.status);

    const pending = statusInflight.get(cacheKey);
    if (pending !== undefined) return pending;

    const request = askSessionStatus(wardSid, subject)
      .then((status) => {
        // Only answers are cached. A failure is not: the next request asks
        // again, so a session resumes as soon as Ward is back.
        statusCache.set(cacheKey, {
          status,
          expiresAt: now() + SESSION_STATUS_CACHE_SECONDS * 1000,
        });
        pruneStatusCache();
        return status;
      })
      .finally(() => statusInflight.delete(cacheKey));
    statusInflight.set(cacheKey, request);
    return request;
  }

  /** Keep the cache bounded on a long-lived server: drop expired entries now and then. */
  function pruneStatusCache(): void {
    if (statusCache.size < 1_000) return;
    const at = now();
    for (const [cacheKey, entry] of statusCache) {
      if (entry.expiresAt <= at) statusCache.delete(cacheKey);
    }
  }

  // -------------------------------------------------------------------------
  // HTTP to Ward's own endpoints
  // -------------------------------------------------------------------------

  async function post(url: string, body: string, ms: number, what: string): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(ms),
      });
    } catch (cause) {
      throw new WardUnavailableError(`${what} request failed`, { cause });
    }
  }

  async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (cause) {
      throw new WardUnavailableError(`${what} answered a body that is not JSON`, { cause });
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new WardUnavailableError(`${what} answered a body outside its contract`);
    }
    return parsed as Record<string, unknown>;
  }

  function configurationError(what: string): WardConfigurationError {
    return new WardConfigurationError(
      `Ward refused this app's client credential at ${what} (401 invalid_client). ` +
        `Check WARD_OIDC_CLIENT_ID and WARD_OIDC_CLIENT_KEY, and that the key's public half ` +
        `is registered for this app in Ward's console.`,
    );
  }

  function discoveryError(error: unknown): WardUnavailableError {
    if (
      error instanceof oidc.ClientError &&
      error.code === "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED"
    ) {
      // Ward answered, but its metadata names another issuer: WARD_OIDC_ISSUER
      // is not what Ward was configured with.
      return new WardConfigurationError(
        "Ward's discovery document names a different issuer. Check WARD_OIDC_ISSUER " +
          "against Ward's own WARD_OIDC_ISSUER.",
        { cause: error },
      );
    }
    return new WardUnavailableError("Ward's discovery document could not be fetched", {
      cause: error,
    });
  }

  // -------------------------------------------------------------------------

  return {
    issuer: issuerString,
    clientId,
    redirectUri,

    async startAuthorization(startOptions = {}) {
      const config = await discover();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const parameters: Record<string, string> = {
        redirect_uri: redirectUri,
        scope: "openid",
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      };
      if (startOptions.prompt !== undefined) parameters["prompt"] = startOptions.prompt;
      const url = oidc.buildAuthorizationUrl(config, parameters);
      return { url: url.href, flow: { state, nonce, codeVerifier } };
    },

    async finishAuthorization(search, flow) {
      let config: oidc.Configuration;
      try {
        config = await discover();
      } catch (error) {
        throw signInErrorFor(error);
      }

      // The URL the browser was sent to, as the browser saw it: the configured
      // redirect URI plus the query Fastify received. `openid-client` derives
      // the token request's `redirect_uri` from it, which must match the
      // authorization request's exactly.
      const currentUrl = new URL(redirectUri);
      currentUrl.search = search;

      let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
      try {
        tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
          pkceCodeVerifier: flow.codeVerifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        });
      } catch (error) {
        throw signInErrorFor(error);
      }

      const claims = tokens.claims();
      const idToken = tokens.id_token;
      const subject = claims?.sub;
      const wardSid = claims?.["ward_sid"];
      const role = claims?.["ward_role"];
      const username = claims?.["preferred_username"];
      if (
        idToken === undefined ||
        typeof subject !== "string" ||
        subject.length === 0 ||
        typeof wardSid !== "string" ||
        wardSid.length === 0 ||
        typeof role !== "string" ||
        role.length === 0
      ) {
        throw new WardSignInError(
          "invalid_callback",
          "Ward's ID token lacks sub, ward_sid or ward_role",
        );
      }
      return {
        subject,
        wardSid,
        role,
        username: typeof username === "string" ? username : "",
        idToken,
      };
    },

    checkSession,

    async sendNotification(input) {
      const body = JSON.stringify({
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: await signClientAssertion(key, clientId, issuerString),
        // Exactly these three beside the credential: Ward refuses any other key.
        subject: input.subject,
        mailSubject: input.mailSubject,
        text: input.text,
      });
      const response = await post(notifyUrl, body, notifyTimeoutMs, "notify");
      if (response.status === 401) throw configurationError("notify");
      if (response.status !== 200) {
        throw new WardUnavailableError(`notify answered ${response.status}`);
      }
      const answer = await readJson(response, "notify");
      if (typeof answer.sent !== "boolean") {
        throw new WardUnavailableError("notify answered a body outside its contract");
      }
      return { sent: answer.sent };
    },

    async endSessionUrl(idTokenHint, state) {
      const config = await discover();
      const parameters: Record<string, string> = { id_token_hint: idTokenHint };
      if (postLogoutRedirectUri !== undefined) {
        parameters["post_logout_redirect_uri"] = postLogoutRedirectUri;
      }
      if (state !== undefined) parameters["state"] = state;
      return oidc.buildEndSessionUrl(config, parameters).href;
    },
  };
}

/**
 * Map whatever the round trip threw to the code the browser is told.
 *
 * - The provider's own `error` (`access_denied` for no grant, a disabled
 *   account or "Back to the app"; anything else it may send) passes through,
 *   if it looks like an OAuth error code.
 * - Ward unreachable, or answering outside the protocol: `ward_unavailable`.
 * - Ward refusing the client credential: `ward_misconfigured`.
 * - Everything about the response itself — a `state`, `nonce` or `iss` that
 *   does not match, a code Ward will not redeem, an ID token that does not
 *   verify: `invalid_callback`.
 */
export function signInErrorFor(error: unknown): WardSignInError {
  if (error instanceof WardSignInError) return error;
  if (error instanceof WardConfigurationError) {
    return new WardSignInError("ward_misconfigured", error.message, { cause: error });
  }
  if (error instanceof WardUnavailableError) {
    return new WardSignInError("ward_unavailable", error.message, { cause: error });
  }
  if (error instanceof oidc.AuthorizationResponseError) {
    const code = /^[a-z_]{1,64}$/.test(error.error) ? error.error : "ward_error";
    return new WardSignInError(code, `Ward answered ${code}`, { cause: error });
  }
  if (error instanceof oidc.ResponseBodyError) {
    if (error.status === 401 || error.error === "invalid_client") {
      return new WardSignInError(
        "ward_misconfigured",
        "Ward refused this app's client credential at the token endpoint. Check " +
          "WARD_OIDC_CLIENT_ID and WARD_OIDC_CLIENT_KEY.",
        { cause: error },
      );
    }
    return new WardSignInError("invalid_callback", `token endpoint: ${error.error}`, {
      cause: error,
    });
  }
  if (error instanceof oidc.ClientError) {
    const unavailable = new Set([
      "OAUTH_RESPONSE_IS_NOT_CONFORM",
      "OAUTH_RESPONSE_IS_NOT_JSON",
      "OAUTH_PARSE_ERROR",
      "OAUTH_TIMEOUT",
      "OAUTH_ABORT",
    ]);
    if (error.code === undefined || unavailable.has(error.code)) {
      return new WardSignInError("ward_unavailable", error.message, { cause: error });
    }
    return new WardSignInError("invalid_callback", error.message, { cause: error });
  }
  // A failed `fetch` is a bare TypeError ("fetch failed"); an argument error
  // from the library carries an ERR_ code and is a bug, reported as such.
  if (error instanceof TypeError && !("code" in error)) {
    return new WardSignInError("ward_unavailable", error.message, { cause: error });
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new WardSignInError("ward_unavailable", error.message, { cause: error });
  }
  return new WardSignInError("ward_error", "the Ward sign-in failed", { cause: error });
}

/**
 * The four (and one optional) env variables the local seed writes and the
 * deploy provides. `undefined` when `WARD_OIDC_ISSUER` is unset — the app runs
 * with local accounts only — and a thrown error naming what is missing when
 * the set is incomplete, which is always a deploy mistake.
 */
export function wardClientOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): WardClientOptions | undefined {
  const issuer = env["WARD_OIDC_ISSUER"]?.trim();
  if (issuer === undefined || issuer === "") return undefined;

  const required = ["WARD_OIDC_CLIENT_ID", "WARD_OIDC_CLIENT_KEY", "WARD_OIDC_REDIRECT_URI"];
  const missing = required.filter((name) => (env[name]?.trim() ?? "") === "");
  if (missing.length > 0) {
    throw new TypeError(`WARD_OIDC_ISSUER is set but ${missing.join(", ")} is not`);
  }
  const postLogout = env["WARD_OIDC_POST_LOGOUT_REDIRECT_URI"]?.trim();
  return {
    issuer,
    clientId: env["WARD_OIDC_CLIENT_ID"]!.trim(),
    clientKey: env["WARD_OIDC_CLIENT_KEY"]!.trim(),
    redirectUri: env["WARD_OIDC_REDIRECT_URI"]!.trim(),
    ...(postLogout === undefined || postLogout === "" ? {} : { postLogoutRedirectUri: postLogout }),
  };
}

function parseHttpUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`ward: ${name} ${JSON.stringify(value)} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`ward: ${name} must be an http(s) URL`);
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "127.0.0.1" ||
    host.startsWith("127.")
  );
}
