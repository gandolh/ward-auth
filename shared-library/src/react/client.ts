/**
 * The browser half, without React: a small client for the plugin's routes and
 * an observable session state the hooks subscribe to.
 *
 * Kept free of React so it can be tested in Node with a fake `fetch`, and so
 * the hooks stay thin enough to read at a glance. Nothing here imports the
 * server bundle: `ward-auth-react.js` must load in a browser.
 */

/** The user the server reports. Mirrors the server's `AuthUser`. */
export interface SessionUser {
  id: string;
  username: string;
  role: string;
  /** False for a user created by a Ward sign-in who has no local password yet. */
  hasPassword: boolean;
}

/** What the browser is told about its session. */
export interface SessionInfo {
  origin: "local" | "ward";
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** What the server says about Ward for this app and this user. */
export interface WardStatus {
  /** The app offers "Sign in with Ward" (its server has Ward configured). */
  enabled: boolean;
  /** The signed-in user has a Ward account linked. Always false when signed out. */
  linked: boolean;
}

/**
 * The server's stable error codes, plus two of the client's own: `network`
 * (no answer at all) and `unknown` (an answer with no recognisable code).
 * Open-ended, because later versions add codes and an app should fall back to
 * a generic message for one it does not know.
 *
 * The Ward codes, and where they appear:
 *
 * - `access_denied` — Ward said no: no grant for this app, a disabled
 *   account, or the person pressed "Back to the app". (Ward may send other
 *   OAuth error codes; they pass through as they are.)
 * - `ward_unavailable` — Ward could not be reached. Also a session `reason`:
 *   a Ward-originated session is refused while Ward cannot vouch for it.
 *   Suggested words: "Ward is unreachable, sign in with your password".
 * - `ward_misconfigured` — Ward refused this app's client credential. An
 *   operator problem; show it like `ward_unavailable`.
 * - `ward_session_ended` — a session `reason`: the Ward session it began with
 *   was signed out or revoked.
 * - `invalid_callback` — the round trip could not be completed (it expired,
 *   was started in another tab, or was tampered with; for a reauthentication,
 *   also when Ward's answer does not show a password typed for it). Try again.
 * - `sign_in_failed` — Ward's answer was fine but the app failed finishing
 *   the sign-in, link or reauthentication (logged on the server). Try again;
 *   if it persists, it is an operator problem.
 * - `already_linked`, `ward_account_in_use` — linking: this user already has
 *   a Ward account, or that Ward account belongs to another user here.
 * - `ward_account_mismatch` — reauthentication came back as another Ward
 *   account.
 * - `not_linked`, `no_local_password` — unlinking.
 * - `reauthentication_required` — setting a first local password needs a
 *   reauthentication (`reauthenticate()`) from the last ten minutes. A plain
 *   Ward sign-in does not count, however recent.
 */
export type AuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "invalid_username"
  | "password_too_short"
  | "password_too_long"
  | "username_taken"
  | "too_many_attempts"
  | "unauthorized"
  | "forbidden"
  | "cross_site"
  | "network"
  | "unknown"
  | "access_denied"
  | "ward_unavailable"
  | "ward_misconfigured"
  | "ward_session_ended"
  | "invalid_callback"
  | "sign_in_failed"
  | "already_linked"
  | "ward_account_in_use"
  | "ward_account_mismatch"
  | "not_linked"
  | "no_local_password"
  | "reauthentication_required"
  | (string & {});

export interface AuthError {
  code: AuthErrorCode;
  /** The HTTP status, when there was a response. */
  status?: number;
  /** Set with `too_many_attempts`: how long until the next attempt is allowed. */
  retryAfterSeconds?: number;
}

export type SessionState =
  | { status: "loading" }
  | { status: "signed_in"; user: SessionUser; session: SessionInfo; ward: WardStatus }
  /**
   * `reason` is set when a cookie was presented and a session check refused
   * it — `ward_unavailable` and `ward_session_ended` among them.
   */
  | { status: "signed_out"; reason?: string; ward: WardStatus }
  | { status: "error"; error: AuthError };

/**
 * What the last Ward round trip came back with, read once from the page's URL
 * (`?ward_error=` or `?ward=`) when the client is created, and removed from
 * the address bar so a reload does not show it again.
 */
export interface WardResult {
  /** `linked` after a link, `reauthenticated` after a verified reauthentication. */
  result?: "linked" | "reauthenticated";
  error?: AuthError;
}

export type ActionResult = { ok: true } | { ok: false; error: AuthError };

export interface AuthClientOptions {
  /**
   * The browser-visible path of the plugin's routes: the app's API prefix plus
   * the plugin's `routePrefix`, e.g. `/atrium/api/auth`.
   */
  basePath: string;
  /** Injected by tests. The global `fetch` otherwise. */
  fetch?: typeof fetch;
  /**
   * Send the browser to a URL (Ward's pages). Injected by tests;
   * `window.location.assign` otherwise.
   */
  navigate?: (url: string) => void;
  /**
   * The page's current URL, read once for a Ward result, and how to replace
   * it without one. Injected by tests; `window.location` and
   * `history.replaceState` otherwise, and nothing at all outside a browser.
   */
  location?: { href: string; replace(url: string): void };
}

export interface AuthClient {
  readonly basePath: string;
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  /** Ask the server who is signed in. Concurrent calls share one request. */
  refresh(): Promise<SessionState>;
  /** `refresh()` once, if nothing has loaded the state yet. */
  ensureLoaded(): void;
  login(username: string, password: string): Promise<ActionResult>;
  logout(): Promise<ActionResult>;
  changePassword(currentPassword: string, newPassword: string): Promise<ActionResult>;
  register(username: string, password: string): Promise<ActionResult>;
  /**
   * "Sign in with Ward": ask the server for Ward's URL and go there. On
   * success the page is navigating away. `returnTo` is a path on this origin
   * to land on afterwards.
   */
  startWardSignIn(options?: { returnTo?: string }): Promise<ActionResult>;
  /** "Link Ward", from settings while signed in. Navigates to Ward. */
  startWardLink(): Promise<ActionResult>;
  /** Reauthenticate with Ward (Ward asks for the password again). Navigates to Ward. */
  startWardReauthentication(): Promise<ActionResult>;
  /** Unlink Ward. The state becomes signed out if this session began with Ward. */
  unlinkWard(): Promise<ActionResult>;
  /**
   * Set a local password: give the current one if there is one; a user with
   * none needs `startWardReauthentication()` in the last ten minutes
   * (`reauthentication_required` otherwise; a Ward sign-in does not count).
   */
  setLocalPassword(newPassword: string, currentPassword?: string): Promise<ActionResult>;
  /** Sign out here and at Ward. Navigates to Ward's end-session page when there is one. */
  signOutOfWard(): Promise<ActionResult>;
  /** The Ward result the page was loaded with, if any. */
  getWardResult(): WardResult;
  /** Forget it (after the app has shown it). */
  clearWardResult(): void;
}

interface SessionBody {
  user: SessionUser | null;
  session: SessionInfo | null;
  reason?: string;
  ward?: WardStatus;
}

const NO_WARD: WardStatus = { enabled: false, linked: false };

/**
 * Read `?ward_error=` / `?ward=` from a URL. Returns the result and the URL
 * without those parameters (or `undefined` when there was nothing to remove).
 */
export function readWardResult(href: string): { result: WardResult; cleaned?: string } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { result: {} };
  }
  const error = url.searchParams.get("ward_error");
  const outcome = url.searchParams.get("ward");
  const result: WardResult = {};
  if (error !== null && /^[a-z_]{1,64}$/.test(error)) result.error = { code: error };
  if (outcome === "linked" || outcome === "reauthenticated") result.result = outcome;
  if (error === null && outcome === null) return { result };
  url.searchParams.delete("ward_error");
  url.searchParams.delete("ward");
  return { result, cleaned: url.href };
}

/**
 * The bits of a browser this file touches, read off `globalThis` so the
 * module also loads in Node (tests) and its types need no DOM library.
 */
interface BrowserGlobals {
  location: { href: string; assign(url: string): void };
  history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
}

function browser(): BrowserGlobals | undefined {
  const candidate = globalThis as unknown as Partial<BrowserGlobals>;
  return candidate.location !== undefined &&
    typeof candidate.location.assign === "function" &&
    candidate.history !== undefined
    ? (candidate as BrowserGlobals)
    : undefined;
}

function browserLocation(): { href: string; replace(url: string): void } | undefined {
  const page = browser();
  if (page === undefined) return undefined;
  return {
    href: page.location.href,
    replace: (url) => page.history.replaceState(page.history.state, "", url),
  };
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const basePath = options.basePath.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const listeners = new Set<() => void>();
  const navigate =
    options.navigate ??
    ((url: string) => {
      const page = browser();
      if (page === undefined) throw new Error("ward-auth: no browser to navigate; pass navigate");
      page.location.assign(url);
    });
  let state: SessionState = { status: "loading" };
  let loaded = false;
  let inflight: Promise<SessionState> | undefined;

  // A Ward round trip ends with a redirect to one of the app's pages carrying
  // the outcome in the query. Read it once, here, and take it out of the
  // address bar so a reload or a shared link does not replay it.
  const location = options.location ?? browserLocation();
  let wardResult: WardResult = {};
  if (location !== undefined) {
    const read = readWardResult(location.href);
    wardResult = read.result;
    if (read.cleaned !== undefined) location.replace(read.cleaned);
  }

  function setState(next: SessionState): void {
    state = next;
    loaded = true;
    for (const listener of listeners) listener();
  }

  function stateFromBody(body: SessionBody): SessionState {
    const ward = body.ward ?? NO_WARD;
    if (body.user !== null && body.session !== null) {
      return { status: "signed_in", user: body.user, session: body.session, ward };
    }
    return body.reason === undefined
      ? { status: "signed_out", ward }
      : { status: "signed_out", reason: body.reason, ward };
  }

  /** What signing out here leaves: signed out, and Ward still offered if it was. */
  function signedOut(): SessionState {
    const enabled =
      state.status === "signed_in" || state.status === "signed_out" ? state.ward.enabled : false;
    return { status: "signed_out", ward: { enabled, linked: false } };
  }

  /**
   * One request. `credentials: "same-origin"` so the cookie goes with it; a
   * JSON body only when there is one, because Fastify refuses an empty body
   * sent as `application/json`.
   */
  async function request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Response | AuthError> {
    try {
      return await doFetch(`${basePath}${path}`, {
        method,
        credentials: "same-origin",
        headers:
          body === undefined
            ? { accept: "application/json" }
            : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { code: "network" };
    }
  }

  async function errorFrom(response: Response): Promise<AuthError> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const record =
      typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const error: AuthError = {
      code: typeof record.error === "string" ? record.error : "unknown",
      status: response.status,
    };
    if (typeof record.retryAfterSeconds === "number")
      error.retryAfterSeconds = record.retryAfterSeconds;
    return error;
  }

  async function refresh(): Promise<SessionState> {
    inflight ??= (async () => {
      try {
        const response = await request("GET", "/session");
        if (!(response instanceof Response)) {
          setState({ status: "error", error: response });
        } else if (!response.ok) {
          setState({ status: "error", error: await errorFrom(response) });
        } else {
          setState(stateFromBody((await response.json()) as SessionBody));
        }
        return state;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  /** Ask the server for a Ward URL and send the browser there. */
  async function goToWard(path: string, body?: unknown): Promise<ActionResult> {
    const response = await request("POST", path, body);
    if (!(response instanceof Response)) return { ok: false, error: response };
    if (!response.ok) {
      const error = await errorFrom(response);
      if (response.status === 401 && error.code === "unauthorized") setState(signedOut());
      return { ok: false, error };
    }
    const { url } = (await response.json()) as { url: string };
    navigate(url);
    return { ok: true };
  }

  /** A guarded action answered with no session body; refresh to pick up its effect. */
  async function act(
    path: string,
    body?: unknown,
  ): Promise<ActionResult & { response?: Response }> {
    const response = await request("POST", path, body);
    if (!(response instanceof Response)) return { ok: false, error: response };
    if (!response.ok) {
      const error = await errorFrom(response);
      if (response.status === 401 && error.code === "unauthorized") setState(signedOut());
      return { ok: false, error };
    }
    return { ok: true, response };
  }

  /** A credential action that, on success, answers with the new session. */
  async function signIn(path: string, body: unknown): Promise<ActionResult> {
    const response = await request("POST", path, body);
    if (!(response instanceof Response)) return { ok: false, error: response };
    if (!response.ok) return { ok: false, error: await errorFrom(response) };
    setState(stateFromBody((await response.json()) as SessionBody));
    return { ok: true };
  }

  return {
    basePath,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    ensureLoaded() {
      if (!loaded && inflight === undefined) void refresh();
    },
    login: (username, password) => signIn("/login", { username, password }),
    register: (username, password) => signIn("/register", { username, password }),
    async logout() {
      const response = await request("POST", "/logout");
      if (!(response instanceof Response)) return { ok: false, error: response };
      if (!response.ok) return { ok: false, error: await errorFrom(response) };
      setState(signedOut());
      return { ok: true };
    },
    async changePassword(currentPassword, newPassword) {
      const response = await request("POST", "/password", { currentPassword, newPassword });
      if (!(response instanceof Response)) return { ok: false, error: response };
      if (!response.ok) {
        const error = await errorFrom(response);
        // The session ended under us (expired, or ended elsewhere): say so.
        if (response.status === 401 && error.code === "unauthorized") setState(signedOut());
        return { ok: false, error };
      }
      return { ok: true };
    },
    startWardSignIn: (startOptions = {}) =>
      goToWard(
        "/ward/start",
        startOptions.returnTo === undefined ? {} : { returnTo: startOptions.returnTo },
      ),
    startWardLink: () => goToWard("/ward/link"),
    startWardReauthentication: () => goToWard("/ward/reauthenticate"),
    async unlinkWard() {
      const result = await act("/ward/unlink");
      if (!result.ok) return result;
      const { signedOut: ended } = (await result.response!.json()) as { signedOut: boolean };
      if (ended) setState(signedOut());
      else await refresh();
      return { ok: true };
    },
    async setLocalPassword(newPassword, currentPassword) {
      const result = await act(
        "/ward/set-password",
        currentPassword === undefined ? { newPassword } : { newPassword, currentPassword },
      );
      if (!result.ok) return result;
      // `hasPassword` is now true; ask so every `useSession` sees it.
      await refresh();
      return { ok: true };
    },
    async signOutOfWard() {
      const result = await act("/ward/logout");
      if (!result.ok) return result;
      const { url } = (await result.response!.json()) as { url: string | null };
      setState(signedOut());
      if (url !== null) navigate(url);
      return { ok: true };
    },
    getWardResult: () => wardResult,
    clearWardResult() {
      if (wardResult.error === undefined && wardResult.result === undefined) return;
      wardResult = {};
      for (const listener of listeners) listener();
    },
  };
}

let defaultClient: AuthClient | undefined;

/**
 * Point the hooks at the plugin's routes. Call once, at startup, before the
 * first render:
 *
 * ```ts
 * configureAuth({ basePath: "/atrium/api/auth" });
 * ```
 */
export function configureAuth(options: AuthClientOptions): AuthClient {
  defaultClient = createAuthClient(options);
  return defaultClient;
}

/** The configured client. Throws if `configureAuth` has not run. */
export function getAuthClient(): AuthClient {
  if (defaultClient === undefined) {
    throw new Error("ward-auth: call configureAuth({ basePath }) before using the hooks");
  }
  return defaultClient;
}
