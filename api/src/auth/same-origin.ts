import type { FastifyRequest } from "fastify";

/**
 * Whether a request came from Ward's own pages, as far as the browser says.
 *
 * Every route that acts on one of Ward's cookies and changes something asks
 * this first: `/refresh` and `/logout` (`features/auth/routes.ts`), the account
 * routes that change a password or sign out other sessions
 * (`features/account/routes.ts`), and the console, whose guard asks it for
 * every method but `GET` and `HEAD` (`console-guard.ts`), as do
 * `/console/login` and `/console/logout`. A no is
 * `403 { "error": "cross_site" }`, decided on headers alone and before any
 * cookie or credential is read, so the answer says nothing about either.
 *
 * ## The rule, stated once
 *
 * **Absent headers pass.** `Sec-Fetch-Site` and `Origin` are set by browsers;
 * a server-side caller sends neither, and refusing a header-less request would
 * break every non-browser caller to guard against something only a browser
 * does. What the check catches is the case that exists: a browser that did
 * send them and said the request came from somewhere else.
 *
 * `Sec-Fetch-Site`, when present, must be exactly `same-origin`. Not
 * `same-site`: Ward's pages are one origin, and every other origin is somewhere
 * else, an app on a sibling host under the same domain included. Not `none`:
 * nothing navigates directly into these routes. `Origin`, when present, must
 * be `WARD_PUBLIC_ORIGIN`. An unparseable `Origin`, including the literal
 * `null` some cross-origin contexts send, is a mismatch, which is the
 * direction to fail in.
 */
export function sameOrigin(request: FastifyRequest, publicOrigin: string): boolean {
  if (!fetchedFromSameOrigin(request)) return false;
  const origin = presentedOrigin(request);
  return origin === undefined || originIs(origin, publicOrigin);
}

/**
 * `sameOrigin` against `WARD_PUBLIC_ORIGIN`, for a caller with no registration
 * step to read the config at: the console guard is a bare hook.
 *
 * The `config.js` import is dynamic for the reason `cookie.ts` gives for
 * `wardSecureCookies`, and it runs only when there is an `Origin` to compare.
 * A request with neither header passes without it, and a `Sec-Fetch-Site`
 * other than `same-origin` is refused without it, so a suite that sends
 * neither header needs no environment.
 */
export async function sameOriginAsWard(request: FastifyRequest): Promise<boolean> {
  if (!fetchedFromSameOrigin(request)) return false;
  const origin = presentedOrigin(request);
  return origin === undefined || originIs(origin, await wardPublicOrigin());
}

function fetchedFromSameOrigin(request: FastifyRequest): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  return typeof fetchSite !== "string" || fetchSite.length === 0 || fetchSite === "same-origin";
}

function presentedOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return origin !== undefined && origin.length > 0 ? origin : undefined;
}

function originIs(origin: string, publicOrigin: string): boolean {
  try {
    return new URL(origin).origin === publicOrigin;
  } catch {
    return false;
  }
}

let publicOriginPromise: Promise<string> | undefined;

/** `WARD_PUBLIC_ORIGIN`, resolved once per process. */
async function wardPublicOrigin(): Promise<string> {
  publicOriginPromise ??= (async () => {
    const { WARD_PUBLIC_ORIGIN } = await import("../config.js");
    return WARD_PUBLIC_ORIGIN;
  })();
  return publicOriginPromise;
}
