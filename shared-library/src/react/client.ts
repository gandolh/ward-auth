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

/**
 * The server's stable error codes, plus two of the client's own: `network`
 * (no answer at all) and `unknown` (an answer with no recognisable code).
 * Open-ended, because later versions add codes (brief 21's `ward_unavailable`)
 * and an app should fall back to a generic message for one it does not know.
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
  | { status: "signed_in"; user: SessionUser; session: SessionInfo }
  /** `reason` is set when a cookie was presented and a session check refused it. */
  | { status: "signed_out"; reason?: string }
  | { status: "error"; error: AuthError };

export type ActionResult = { ok: true } | { ok: false; error: AuthError };

export interface AuthClientOptions {
  /**
   * The browser-visible path of the plugin's routes: the app's API prefix plus
   * the plugin's `routePrefix`, e.g. `/atrium/api/auth`.
   */
  basePath: string;
  /** Injected by tests. The global `fetch` otherwise. */
  fetch?: typeof fetch;
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
}

interface SessionBody {
  user: SessionUser | null;
  session: SessionInfo | null;
  reason?: string;
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const basePath = options.basePath.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const listeners = new Set<() => void>();
  let state: SessionState = { status: "loading" };
  let loaded = false;
  let inflight: Promise<SessionState> | undefined;

  function setState(next: SessionState): void {
    state = next;
    loaded = true;
    for (const listener of listeners) listener();
  }

  function stateFromBody(body: SessionBody): SessionState {
    if (body.user !== null && body.session !== null) {
      return { status: "signed_in", user: body.user, session: body.session };
    }
    return body.reason === undefined
      ? { status: "signed_out" }
      : { status: "signed_out", reason: body.reason };
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
      setState({ status: "signed_out" });
      return { ok: true };
    },
    async changePassword(currentPassword, newPassword) {
      const response = await request("POST", "/password", { currentPassword, newPassword });
      if (!(response instanceof Response)) return { ok: false, error: response };
      if (!response.ok) {
        const error = await errorFrom(response);
        // The session ended under us (expired, or ended elsewhere): say so.
        if (response.status === 401 && error.code === "unauthorized")
          setState({ status: "signed_out" });
        return { ok: false, error };
      }
      return { ok: true };
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
