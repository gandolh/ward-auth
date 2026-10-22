import { useEffect, useState } from "react";

import { WARD_API } from "./api.js";

/**
 * The login page's half of "Sign in with Ward" (brief 18).
 *
 * When an app sends someone to Ward and they are not signed in, Ward's
 * provider sends them here as `/login?oidc=<uid>`. The uid names the
 * interaction waiting for them at `/ward-api/refresh/oidc/<uid>`, which is
 * where the browser goes back to once the ordinary `POST /login` has set the
 * refresh cookie. That route, not this page, decides what happens next.
 *
 * ## Why this cannot be an open redirect
 *
 * `?next=` needs a nine-rule allowlist because it carries a path. `?oidc=`
 * carries only an id, and the destination is built here from a constant: the
 * value must match nanoid's alphabet and a bounded length, so nothing in it
 * can name a host, a scheme or a different path. A forged uid lands on Ward's
 * own "this sign-in has expired" page — the interaction route also requires
 * the provider's own cookie for that interaction, which a link cannot carry.
 */

/** nanoid's alphabet, bounded. The same pattern the API route enforces. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The interaction id from `?oidc=`, or `undefined` for an ordinary sign-in. */
export function oidcInteraction(raw: string | null | undefined): string | undefined {
  return typeof raw === "string" && UID_PATTERN.test(raw) ? raw : undefined;
}

/** Where the browser goes after signing in, to finish the app's authorization. */
export function interactionResumeUrl(uid: string): string {
  return `${WARD_API}/refresh/oidc/${uid}`;
}

/** "Back to <app>": the app gets `access_denied` and shows its own message. */
export function interactionAbortUrl(uid: string): string {
  return `${WARD_API}/refresh/oidc/${uid}/abort`;
}

export interface InteractionClient {
  clientId: string;
  name: string;
}

/**
 * Which app the interaction is for, fetched once per mount, so the heading can
 * say "Continue to Atrium". `undefined` while loading and when the interaction
 * is unknown or expired; the page then says "Sign in", and the resume route
 * explains the expiry if the person goes on.
 */
export function useInteractionClient(uid: string | undefined): InteractionClient | undefined {
  const [client, setClient] = useState<InteractionClient | undefined>();

  useEffect(() => {
    if (uid === undefined) return;
    let live = true;
    void fetch(`${interactionResumeUrl(uid)}/client`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => (response.ok ? parseClient(await response.json()) : undefined))
      .catch(() => undefined)
      .then((found) => {
        if (live) setClient(found);
      });
    return () => {
      live = false;
    };
  }, [uid]);

  return client;
}

/** Narrow the `/client` body; anything else is "unknown". */
export function parseClient(body: unknown): InteractionClient | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { clientId, name } = body as { clientId?: unknown; name?: unknown };
  if (typeof clientId !== "string" || typeof name !== "string" || name === "") return undefined;
  return { clientId, name };
}
