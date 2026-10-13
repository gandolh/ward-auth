import { ACCESS_TOKEN_TTL_SECONDS } from "../tokens/claims.js";

/**
 * Ward's session cookies: their names, their scopes, and the serialisation.
 *
 * No `@fastify/cookie`. Two cookies with fixed attributes is about forty lines
 * of `Set-Cookie` assembly, and the brief forbids adding a dependency — but the
 * better reason is that the attributes here are the security boundary, and
 * having them written out where they can be read beats having them spread
 * across a plugin's option bag.
 *
 * ## Two cookies, both scoped to Ward
 *
 * | | name | path | lifetime |
 * |---|---|---|---|
 * | access | `ward_session` | `/ward-api` | 15 minutes |
 * | refresh | `ward_refresh` | `/ward-api/refresh` | 30 days |
 *
 * The **access** cookie is read by Ward's own API and nothing else:
 * `GET /ward-api/session` and the `/ward-api/account` routes, which serve
 * Ward's sign-in and account pages. Until 2026-10-13 it sat at `Path=/` so the
 * estate's apps could read it; that shared-cookie contract is retired (brief
 * 30) and apps now sign people in through OpenID Connect with sessions of their
 * own. So the cookie is scoped to the API prefix, and an app on the same origin
 * never receives it.
 *
 * The **refresh** cookie is scoped tighter still, to `Path=/ward-api/refresh`.
 * A 30-day credential that can mint fresh access tokens is the most valuable
 * thing Ward hands out, and scoped to one path the browser only ever discloses
 * it to the endpoints that consume it: `/refresh`, `/refresh/logout` and the
 * OIDC login step at `/refresh/oidc/:uid`.
 *
 * ## The legacy `Path=/` access cookie
 *
 * Browsers that signed in before the change still hold a `ward_session` at
 * `Path=/`. A cookie is identified by name, domain **and path**, so setting the
 * new one does not replace the old one: both are stored, and both are sent to
 * `/ward-api/...`, in an order no code should rely on. Two things follow:
 *
 * - Every response that sets or clears the session also expires the
 *   `Path=/` variant (`LEGACY_ACCESS_COOKIE_PATH`), so the duplicate disappears
 *   the next time the person touches Ward.
 * - Readers take **every** `ward_session` value (`readCookies`) and use the
 *   first one that is a live session (`auth/access-session.ts`), never simply
 *   the first one on the header.
 *
 * The refresh cookie never moved, so it has no legacy twin and is read with
 * `readCookie` (first wins) on purpose: trying a second refresh token after a
 * first one would present a rotated token, which is reuse detection's signal
 * and revokes the whole family.
 *
 * ## `/ward-api/refresh` is the *browser's* path, not Fastify's
 *
 * Caddy serves Ward with `handle_path /ward-api/*`, which strips the prefix, so
 * the route is registered at `/refresh` inside Fastify while the browser sees
 * `/ward-api/refresh`. A cookie `Path` is matched by the browser against the
 * URL it is requesting, so it must carry the *public* path. Getting this
 * backwards produces a cookie that is never sent, which surfaces as "refresh
 * always 401s in production and works fine in tests".
 *
 * ## `SameSite=Lax` is also the CSRF defence
 *
 * `/refresh` and `/logout` are state-changing `POST`s with no CSRF token. They
 * do not need one: `Lax` means the browser withholds these cookies from any
 * cross-site `POST`, so a form on `evil.example` cannot reach either endpoint
 * with credentials attached. `Strict` was not chosen because it also withholds
 * the refresh cookie on the top-level navigation an OIDC client starts, which
 * lands on `/ward-api/refresh/oidc/:uid` from the app's page and has to know
 * who is signed in. Do not relax this to `None` — that reintroduces the CSRF
 * surface *and* requires `Secure` unconditionally.
 */

/** The access-token cookie, read by `GET /session` and the `/account` routes. */
export const ACCESS_COOKIE_NAME = "ward_session";

/** The refresh-token cookie. Only the routes under `/ward-api/refresh` see it. */
export const REFRESH_COOKIE_NAME = "ward_refresh";

/**
 * `Path=/ward-api` — Ward's API prefix as the browser sees it, so the cookie
 * reaches `/ward-api/session` and `/ward-api/account/...` and no app.
 */
export const ACCESS_COOKIE_PATH = "/ward-api";

/**
 * Where the access cookie lived until the shared-cookie contract was retired.
 * Only ever written to expire it; see the header.
 */
export const LEGACY_ACCESS_COOKIE_PATH = "/";

/**
 * `Path=/ward-api/refresh` — the browser-visible path, prefix included.
 * See the note above about `handle_path` stripping it before Fastify sees it.
 */
export const REFRESH_COOKIE_PATH = "/ward-api/refresh";

/**
 * Refresh-token lifetime: **30 days**, per `corpus/wiki/decisions-tokens.md`
 * ("15-minute access tokens, 30-second introspection cache").
 *
 * This is both the cookie's `Max-Age` and the row's `expires_at`, and they are
 * the same constant on purpose — a cookie that outlives its row produces a
 * client that keeps presenting a credential Ward has already forgotten.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The access cookie's `Max-Age`, kept equal to the token's own `exp`. */
export const ACCESS_COOKIE_MAX_AGE_SECONDS = ACCESS_TOKEN_TTL_SECONDS;

/** The attributes this module will emit. Not general-purpose; Ward's set only. */
export interface CookieOptions {
  name: string;
  value: string;
  path: string;
  /** Omitted entirely for a session cookie; `0` to expire immediately. */
  maxAgeSeconds?: number;
  /** See `secureCookiesFor` — never hard-code `true` at a call site. */
  secure: boolean;
}

/**
 * A cookie name must be an RFC 6265 token and a value must avoid the separator
 * set. Both of Ward's values are already safe — a compact JWS is
 * base64url-with-dots and a refresh token is hex — so this exists to make a
 * future value that *is not* safe fail loudly here rather than emit a header
 * that a browser silently truncates at the first stray character.
 */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[!#-+\--:<-[\]-~]*$/;

/**
 * Build one `Set-Cookie` value.
 *
 * `HttpOnly` and `SameSite=Lax` are unconditional — there is no parameter for
 * them, because there is no Ward cookie that should be readable from JavaScript
 * or sent on a cross-site POST, and an option is an invitation to set it wrong.
 */
export function serializeCookie(options: CookieOptions): string {
  if (!COOKIE_NAME_PATTERN.test(options.name)) {
    throw new TypeError(`serializeCookie: unsafe cookie name ${JSON.stringify(options.name)}`);
  }
  if (!COOKIE_VALUE_PATTERN.test(options.value)) {
    // Deliberately does NOT include the value in the message: this function is
    // only ever called with a token, and the message ends up in a log.
    throw new TypeError(`serializeCookie: unsafe cookie value for ${options.name}`);
  }

  const parts = [
    `${options.name}=${options.value}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.secure) parts.push("Secure");

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAgeSeconds)}`);
    // `Expires` alongside `Max-Age` is redundant for every browser in use, and
    // is emitted only for the clearing case below where an ancient date is the
    // most compatible way to say "drop this now".
  }

  return parts.join("; ");
}

/**
 * The `Set-Cookie` values that establish a session: the access cookie, the
 * refresh cookie, and the expiry of the legacy `Path=/` access cookie.
 *
 * `refreshMaxAgeSeconds` defaults to the full 30 days and is overridden on a
 * rotation, where `R2` inherits its family's absolute expiry and therefore has
 * less than 30 days left (see `refresh.ts`). A cookie outliving its row means
 * the client keeps presenting a credential Ward has already forgotten.
 */
export function sessionCookies(params: {
  accessToken: string;
  refreshToken: string;
  secure: boolean;
  refreshMaxAgeSeconds?: number;
}): [string, string, string] {
  return [
    serializeCookie({
      name: ACCESS_COOKIE_NAME,
      value: params.accessToken,
      path: ACCESS_COOKIE_PATH,
      maxAgeSeconds: ACCESS_COOKIE_MAX_AGE_SECONDS,
      secure: params.secure,
    }),
    serializeCookie({
      name: REFRESH_COOKIE_NAME,
      value: params.refreshToken,
      path: REFRESH_COOKIE_PATH,
      maxAgeSeconds: params.refreshMaxAgeSeconds ?? REFRESH_TOKEN_TTL_SECONDS,
      secure: params.secure,
    }),
    clearCookie(ACCESS_COOKIE_NAME, LEGACY_ACCESS_COOKIE_PATH, params.secure),
  ];
}

/**
 * The `Set-Cookie` values that destroy a session: both cookies, plus the
 * legacy `Path=/` access cookie a browser may still hold.
 *
 * **`Path` and `Secure` must match what was set**, or the browser treats these
 * as two *different* cookies and leaves the originals in place — the classic
 * "logout doesn't log out" bug. That is why this takes `secure` rather than
 * omitting it: a cleared cookie emitted without `Secure` where the original had
 * it can be shadowed rather than replaced.
 *
 * Both an empty value and `Max-Age=0` are sent, plus a 1970 `Expires` for the
 * benefit of anything that ignores `Max-Age`.
 */
export function clearedSessionCookies(params: { secure: boolean }): [string, string, string] {
  return [
    clearCookie(ACCESS_COOKIE_NAME, ACCESS_COOKIE_PATH, params.secure),
    clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, params.secure),
    clearCookie(ACCESS_COOKIE_NAME, LEGACY_ACCESS_COOKIE_PATH, params.secure),
  ];
}

function clearCookie(name: string, path: string, secure: boolean): string {
  return `${serializeCookie({ name, value: "", path, maxAgeSeconds: 0, secure })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Every non-empty value a `Cookie` request header carries for `name`, in
 * header order.
 *
 * A browser sends every stored cookie whose path matches, so the same name can
 * appear more than once — today, a `ward_session` at `Path=/ward-api` next to
 * the legacy one at `Path=/`. RFC 6265 only *recommends* sending the longer
 * path first, so a reader that has to pick one picks by validity, not by
 * position (`auth/access-session.ts`).
 *
 * A cleared cookie can still be presented by a client that ignored the
 * expiry; an empty value is treated as absent rather than as a token.
 */
export function readCookies(header: string | string[] | undefined, name: string): string[] {
  if (header === undefined) return [];

  const flat = Array.isArray(header) ? header.join("; ") : header;
  const values: string[] = [];

  for (const pair of flat.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;

    const value = pair.slice(eq + 1).trim();
    if (value.length > 0) values.push(value);
  }

  return values;
}

/**
 * The **first** value a `Cookie` request header carries for `name`.
 *
 * For a cookie with one path only — the refresh cookie — where a duplicate is a
 * client bug or a shadowing attempt and must not be tried twice (see the
 * header). The access cookie is read with `readCookies`.
 */
export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string | undefined {
  return readCookies(header, name)[0];
}

/**
 * Whether Ward's cookies carry `Secure`, derived from `WARD_PUBLIC_ORIGIN`.
 *
 * `Secure` **unless** the public origin is plain HTTP on loopback. The
 * exception exists because a `Secure` cookie is not stored at all over
 * `http://127.0.0.1`, so without it nobody could run the login flow locally
 * without terminating TLS first — and the workaround people reach for instead
 * is dropping `Secure` everywhere.
 *
 * Note the shape of the failure this cannot produce: the condition is
 * `http:` **and** loopback, so a plain-HTTP origin on a real hostname — the
 * genuinely dangerous case, a session cookie crossing a network in the clear —
 * still gets `Secure` and simply does not work. That is the correct direction
 * to fail in. There is no environment flag and no `NODE_ENV` branch, matching
 * brief 00's decision that the environment contract has no environment branch.
 */
export function secureCookiesFor(publicOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(publicOrigin);
  } catch {
    // `config.ts` already validated this as a bare origin, so an unparseable
    // value means something bypassed config. Fail closed.
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

let secureCookiesPromise: Promise<boolean> | undefined;

/**
 * `secureCookiesFor(WARD_PUBLIC_ORIGIN)`, resolved once per process.
 *
 * The `config.js` import is **dynamic** for the reason `db/connection.ts`
 * documents at length: a static import is hoisted, so it would run zod
 * validation — and its `process.exit(1)` — merely because something imported
 * `serializeCookie`. Keeping it dynamic is what lets a cookie test run with no
 * environment set at all.
 */
export async function wardSecureCookies(): Promise<boolean> {
  secureCookiesPromise ??= (async () => {
    const { WARD_PUBLIC_ORIGIN } = await import("../config.js");
    return secureCookiesFor(WARD_PUBLIC_ORIGIN);
  })();
  return secureCookiesPromise;
}

/** Drop the memoised value. Tests only. */
export function resetCookieConfigForTests(): void {
  secureCookiesPromise = undefined;
}
