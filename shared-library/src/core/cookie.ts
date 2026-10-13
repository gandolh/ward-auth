/**
 * The app's session cookie: serialisation, reading, and the `Secure` rule.
 *
 * Ported from Ward's `api/src/auth/cookie.ts`. No `@fastify/cookie`: one
 * cookie with fixed attributes is a few lines of `Set-Cookie` assembly, and
 * the attributes are the security boundary — better written out where they
 * can be read than spread across a plugin's option bag.
 *
 * ## The attributes, and why each is fixed
 *
 * - **Name `<app>_session`**, unique per app. The estate shares one origin, so
 *   two apps using one name would overwrite each other's cookie.
 * - **`HttpOnly`**, unconditional: no script on the page ever reads it.
 * - **`SameSite=Lax`**, unconditional, and it is also the CSRF defence. The
 *   browser withholds the cookie from any cross-site `POST`, so a form on
 *   another site cannot act with it. `Strict` would also withhold it on the
 *   top-level navigation back from Ward's login page (brief 21), which breaks
 *   the return hop.
 * - **`Secure`** unless the app's public origin is plain HTTP on loopback —
 *   see `secureCookiesFor`.
 * - **`Path=` the app's API prefix, as the browser sees it.** Scoped, so the
 *   cookie is not sent to every other app on the shared origin. Every request
 *   that needs the session — WebSocket upgrades and `<img>` fetches included —
 *   must live under that path. It is the *browser's* path: when the reverse
 *   proxy strips a prefix before Fastify sees the request, the cookie must
 *   still carry the public one, or the browser never sends it.
 */

/** What `serializeCookie` emits. Not general-purpose; this library's set only. */
export interface CookieOptions {
  name: string;
  value: string;
  path: string;
  /** Omitted entirely for a browser-session cookie; `0` to expire immediately. */
  maxAgeSeconds?: number;
  /** From `secureCookiesFor` — never hard-code it. */
  secure: boolean;
}

/**
 * An RFC 6265 token for the name, and a value free of separators. Session
 * tokens are base64url, so they always pass; this exists so a future value
 * that does not fails loudly here instead of being truncated by a browser.
 */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[!#-+\--:<-[\]-~]*$/;

/** A `Path` attribute: absolute, and nothing that would end the attribute early. */
const COOKIE_PATH_PATTERN = /^\/[^;\s,]*$/;

/** Whether `name` can be a cookie name. The plugin checks its option at boot. */
export function isValidCookieName(name: string): boolean {
  return COOKIE_NAME_PATTERN.test(name);
}

/** Whether `path` can be a cookie `Path`. The plugin checks its option at boot. */
export function isValidCookiePath(path: string): boolean {
  return COOKIE_PATH_PATTERN.test(path);
}

/**
 * Build one `Set-Cookie` value. `HttpOnly` and `SameSite=Lax` have no
 * parameter, because there is no session cookie that should lack them and an
 * option is an invitation to set it wrong.
 */
export function serializeCookie(options: CookieOptions): string {
  if (!isValidCookieName(options.name)) {
    throw new TypeError(`serializeCookie: unsafe cookie name ${JSON.stringify(options.name)}`);
  }
  if (!COOKIE_VALUE_PATTERN.test(options.value)) {
    // The value is deliberately not in the message: it is a session token, and
    // the message ends up in a log.
    throw new TypeError(`serializeCookie: unsafe cookie value for ${options.name}`);
  }
  if (!isValidCookiePath(options.path)) {
    throw new TypeError(`serializeCookie: unsafe cookie path ${JSON.stringify(options.path)}`);
  }

  const parts = [
    `${options.name}=${options.value}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.trunc(options.maxAgeSeconds))}`);
  }
  return parts.join("; ");
}

/**
 * The `Set-Cookie` value that destroys the cookie.
 *
 * **`Path` and `Secure` must match what was set**, or the browser treats this
 * as a *different* cookie and keeps the original — the classic "logout does not
 * log out" bug. An empty value, `Max-Age=0` and a 1970 `Expires` for anything
 * that ignores `Max-Age`.
 */
export function clearedCookie(name: string, path: string, secure: boolean): string {
  return `${serializeCookie({ name, value: "", path, maxAgeSeconds: 0, secure })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Read one cookie out of a `Cookie` request header.
 *
 * Returns the **first** occurrence. A duplicate name is a client bug or a
 * shadowing attempt (a cookie of the same name set at a broader path to sit in
 * front of the real one); the browser sends the more specific path first, and
 * taking the first match is the safer of the two readings.
 */
export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string | undefined {
  if (header === undefined) return undefined;

  const flat = Array.isArray(header) ? header.join("; ") : header;
  for (const pair of flat.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;

    const value = pair.slice(eq + 1).trim();
    // A cleared cookie can still be presented by a client that ignored the
    // expiry. An empty value is absent, not a token.
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/**
 * Whether the cookie carries `Secure`, derived from the app's public origin.
 *
 * `Secure` **unless** the origin is plain HTTP on loopback, because a `Secure`
 * cookie is not stored at all over `http://localhost`, and the workaround
 * people reach for instead is dropping `Secure` everywhere. The condition is
 * `http:` **and** loopback, so plain HTTP on a real hostname — a session
 * cookie crossing a network in the clear — still gets `Secure` and simply does
 * not work. That is the correct direction to fail in. An unparseable origin
 * also fails closed.
 */
export function secureCookiesFor(publicOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(publicOrigin);
  } catch {
    return true;
  }

  if (url.protocol !== "http:") return true;

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.startsWith("127.");
  return !isLoopback;
}
