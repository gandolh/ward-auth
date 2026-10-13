import { hkdfSync, type KeyObject } from "node:crypto";
import type Database from "better-sqlite3";
import Provider, {
  interactionPolicy,
  type Configuration,
  type KoaContextWithOIDC,
} from "oidc-provider";

import { recordAudit } from "../db/audit-log.js";
import { listFamily, revokeFamily } from "../db/refresh-tokens.js";
import type { WardKeySet, WardSigningKey } from "../tokens/keys.js";
import { wardFindAccount } from "./account.js";
import { sqliteAdapterFactory } from "./adapter.js";
import { CLIENT_ALG, CLIENT_ASSERTION_ALGS } from "./clients.js";
import { interactionUrl, type OidcLayout } from "./layout.js";

/**
 * The `oidc-provider` instance, configured down to the one flow Ward offers:
 * the authorization code grant with PKCE (`S256`), confidential clients
 * authenticating with `private_key_jwt`, ID tokens signed `EdDSA` with Ward's
 * existing key. No implicit flow, no password grant, no dynamic registration,
 * no refresh tokens, and nothing optional the estate does not use.
 *
 * ## Lifetimes, and what the provider's own session still does
 *
 * Settled 2026-10-13 in decisions-oidc.md. The interaction runs on **every**
 * authorization (the `ward_session` check below), and it asks Ward's refresh
 * family, never the provider's session. So the provider session no longer
 * answers "is this person signed in". It carries exactly one hand-off: the
 * account the interaction settled, from the interaction to the resumed
 * authorization, and from there to the code exchange, because codes expire
 * with the session that issued them. It lives as long as one interaction may
 * (ten minutes) and no longer: a session shorter than that can expire under an
 * interaction that began while it was alive, and the provider then refuses to
 * finish that interaction at all.
 */

/** Codes are exchanged by the app's server straight after the redirect. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
/** From "Sign in with Ward" to the password typed: ten minutes is generous. */
export const INTERACTION_TTL_SECONDS = 10 * 60;
/** The hand-off described above; never longer than one interaction. */
export const SESSION_TTL_SECONDS = INTERACTION_TTL_SECONDS;
/** Outlives the code by a margin; read again only at the exchange. */
export const GRANT_TTL_SECONDS = 10 * 60;
/** Nothing at Ward accepts the access token (userinfo is off); kept short. */
export const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
/** Read once, by the app, at sign-in. Also the logout hint, which ignores expiry. */
export const ID_TOKEN_TTL_SECONDS = 5 * 60;

/** The claims an ID token carries, all under the `openid` scope. Never email. */
export const ID_TOKEN_CLAIMS = ["sub", "preferred_username", "ward_sid", "ward_role"] as const;

/**
 * Ward's private key as the provider's signing JWK. The private half has to
 * reach the provider to sign; `kid`, `alg` and `use` are copied from the public
 * key Ward already publishes at `/.well-known/jwks.json`, so the two JWKS
 * documents name the same key the same way.
 */
function signingJwk(key: WardSigningKey): Record<string, unknown> {
  const exported = key.privateKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    kty: exported["kty"],
    crv: exported["crv"],
    x: exported["x"],
    d: exported["d"],
    kid: key.kid,
    alg: CLIENT_ALG,
    use: "sig",
  };
}

/**
 * Cookie-signing keys, derived from the signing key rather than configured.
 *
 * The provider signs its cookies with HMAC keys and refuses to run safely
 * without some. A new environment variable would be one more secret to
 * generate, back up and keep out of repos; HKDF over the signing key gives a
 * key that is exactly as secret as one Ward already guards, and is independent
 * of it for any other purpose. During a key rotation the previous key's
 * derivation is kept second, so a flow begun before the switch still verifies.
 */
function cookieKeys(keySet: WardKeySet): string[] {
  const derive = (key: KeyObject): string =>
    Buffer.from(
      hkdfSync(
        "sha256",
        key.export({ format: "der", type: "pkcs8" }),
        Buffer.alloc(0),
        "ward oidc-provider cookie keys v1",
        32,
      ),
    ).toString("base64url");
  const keys = [derive(keySet.current.privateKey)];
  if (keySet.previous) keys.push(derive(keySet.previous.privateKey));
  return keys;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * A bare page in Ward's register. No external fonts or styles: the provider's
 * defaults pull a Google font, which would tell a third party every time
 * someone hits an error at Ward.
 */
export function plainPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Ward</title>
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1d1d1b;background:#f4f2ec}h1{font-size:1.4rem;font-weight:600}code{font-size:.9em}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

export interface WardProviderOptions {
  db: Database.Database;
  layout: OidcLayout;
  keySet: WardKeySet;
}

export function createWardProvider({ db, layout, keySet }: WardProviderOptions): Provider {
  /**
   * The login prompt's first check, and the reason the interaction runs every
   * time. It asks for the interaction unless this very request is the resume
   * of one that just finished (`result.login` set). A live provider session is
   * therefore never enough on its own; only the interaction, which reads
   * Ward's refresh cookie, can let an authorization through.
   */
  const policy = interactionPolicy.base();
  policy
    .get("login")!
    .checks.add(
      new interactionPolicy.Check(
        "ward_session",
        "Ward decides on every authorization whether the End-User is signed in",
        (ctx) =>
          ctx.oidc.result?.["login"] === undefined
            ? interactionPolicy.Check.REQUEST_PROMPT
            : interactionPolicy.Check.NO_NEED_TO_PROMPT,
      ),
      0,
    );

  const keys = keySet.previous
    ? [signingJwk(keySet.current), signingJwk(keySet.previous)]
    : [signingJwk(keySet.current)];

  const configuration: Configuration = {
    adapter: sqliteAdapterFactory(db),
    findAccount: wardFindAccount(db),
    jwks: { keys },

    // Every client comes from the `apps` table through the adapter.
    clients: [],
    clientDefaults: {
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "private_key_jwt",
      id_token_signed_response_alg: CLIENT_ALG,
    },
    clientAuthMethods: ["private_key_jwt"],
    responseTypes: ["code"],
    scopes: ["openid"],
    pkce: { required: () => true },
    enabledJWA: {
      clientAuthSigningAlgValues: CLIENT_ASSERTION_ALGS,
      idTokenSigningAlgValues: [CLIENT_ALG],
    },

    // The scope-to-claims map. Every claim rides on `openid`, and with
    // `conformIdTokenClaims` off they land in the ID token itself, which is the
    // only token an app reads. `email` is absent and therefore unreachable.
    claims: {
      openid: [...ID_TOKEN_CLAIMS],
      sid: null,
      auth_time: null,
      iss: null,
      acr: null,
    },
    conformIdTokenClaims: false,

    cookies: {
      keys: cookieKeys(keySet),
      // The provider's session cookie is scoped to the issuer's path, never
      // `/`: it has no business reaching the apps that share this origin.
      long: { httpOnly: true, sameSite: "lax", path: layout.issuerPath },
      short: { httpOnly: true, sameSite: "lax" },
    },

    ttl: {
      AuthorizationCode: AUTHORIZATION_CODE_TTL_SECONDS,
      Interaction: INTERACTION_TTL_SECONDS,
      Session: SESSION_TTL_SECONDS,
      Grant: GRANT_TTL_SECONDS,
      AccessToken: ACCESS_TOKEN_TTL_SECONDS,
      IdToken: ID_TOKEN_TTL_SECONDS,
    },

    interactions: {
      policy,
      url: (_ctx, interaction) => interactionUrl(layout, interaction.uid),
    },

    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
        // The app asked for "sign out of Ward too" by sending the person here,
        // so there is no second question: the form submits itself, the way the
        // provider already does when it holds no session.
        logoutSource: async (ctx, form) => {
          ctx.body = plainPage(
            "Signing you out of Ward",
            `${form.replace("</form>", '<input type="hidden" name="logout" value="yes"/></form>')}
  <noscript><button type="submit" form="op.logoutForm">Continue</button></noscript>
  <script>document.forms[0].submit()</script>`,
          );
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.body = plainPage("Signed out", "<p>You are signed out of Ward.</p>");
        },
      },
      userinfo: { enabled: false },
      dPoP: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      resourceIndicators: { enabled: false },
      registration: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: false },
    },

    renderError: async (ctx, out) => {
      ctx.type = "html";
      ctx.body = plainPage(
        "Ward could not finish this sign-in",
        `<p>Go back to the app and start again. If it keeps happening, the app's
  sign-in settings at Ward need a look.</p>
  <p><code>${escapeHtml(out.error)}</code>${
    out.error_description === undefined ? "" : ` — ${escapeHtml(out.error_description)}`
  }</p>`,
      );
    },
  };

  const provider = new Provider(layout.issuer, configuration);

  // The URL the provider builds from a request comes from its Host and
  // protocol; `routes.ts` overwrites the forwarded pair with the issuer's on
  // every request, and this is what makes the provider read them.
  provider.proxy = true;

  /**
   * RP-initiated logout ends the **Ward** session too.
   *
   * An app sends a person to the end-session endpoint only when they chose
   * "sign out of Ward too". Once the provider has validated the
   * `id_token_hint` — Ward's signature, the client as its audience — the
   * family it names in `ward_sid` is revoked, exactly as `POST /logout` would.
   * The hint is what makes this safe to do on a GET: only the app's server ever
   * held that ID token, so a cross-site page cannot produce one. Without a
   * hint, nothing at Ward is revoked.
   */
  provider.use(async (ctx: KoaContextWithOIDC, next) => {
    await next();
    if (ctx.oidc?.route !== "end_session" || ctx.status !== 200) return;
    const hint = ctx.oidc.entities.IdTokenHint as { payload?: Record<string, unknown> } | undefined;
    if (hint?.payload === undefined || ctx.oidc.entities.Client === undefined) return;
    endWardFamily(db, hint.payload, ctx.oidc.entities.Client.clientId);
  });

  return provider;
}

function endWardFamily(
  db: Database.Database,
  claims: Record<string, unknown>,
  clientId: string,
): void {
  const sub = claims["sub"];
  const familyId = claims["ward_sid"];
  if (typeof sub !== "string" || typeof familyId !== "string") return;

  db.transaction(() => {
    // The family must be this subject's — the same pairing rule as
    // `hasLiveFamily`, here so a hint cannot name someone else's session.
    if (!listFamily(db, familyId).some((row) => row.subject === sub)) return;
    const revoked = revokeFamily(db, familyId, "logout");
    if (revoked === 0) return;
    recordAudit(db, {
      actorKind: "account",
      actorSubject: sub,
      actorLabel: sub,
      action: "session.logout",
      targetKind: "session",
      targetId: familyId,
      detail: { tokensRevoked: revoked, via: "oidc", client: clientId },
    });
  })();
}
