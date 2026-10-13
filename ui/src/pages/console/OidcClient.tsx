/**
 * One app as an OpenID Connect client: where Ward may send people back to, and
 * the public key the app proves itself with (brief 18).
 *
 * ## Ward holds the public half only
 *
 * The app's server signs a short assertion with its private key every time it
 * exchanges a code; Ward checks it against the key pasted here. The operator
 * makes the pair with `npm run oidc-client-key --workspace=api -- <slug>`,
 * which prints the app's env line and the public JSON — and only the JSON
 * belongs here. A pasted private key is refused with its own message, because
 * the right response to it is a new key, not a quiet repair.
 *
 * ## Exact strings
 *
 * The provider compares a redirect URI as an exact string, so the dev server's
 * URI and the production one are two lines here, one per environment. Nothing
 * is normalised on the way in: a near-miss is refused at save, not discovered
 * as `invalid_redirect_uri` on somebody's first sign-in.
 */

import { useState } from "react";

import { consoleApi, type AppView } from "../../console-api.js";
import { useWriter } from "./session.js";
import { Alert, Id, Panel } from "./ui.js";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function keysText(jwks: AppView["oidc"]["jwks"]): string {
  if (jwks === null) return "";
  return jwks.keys.length === 1 ? JSON.stringify(jwks.keys[0]) : JSON.stringify(jwks);
}

export function OidcClientPanel({
  app,
  reload,
}: {
  app: AppView;
  reload: () => void;
}): React.JSX.Element {
  const writer = useWriter();
  const [redirectUris, setRedirectUris] = useState(app.oidc.redirectUris.join("\n"));
  const [postLogout, setPostLogout] = useState(app.oidc.postLogoutRedirectUris.join("\n"));
  const [keys, setKeys] = useState(keysText(app.oidc.jwks));
  const [keysError, setKeysError] = useState<string | undefined>(undefined);

  const isClient = app.oidc.redirectUris.length > 0 && app.oidc.jwks !== null;
  const kids = app.oidc.jwks?.keys.map((key) => String(key["kid"])) ?? [];

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    let jwks: unknown = null;
    if (keys.trim() !== "") {
      try {
        jwks = JSON.parse(keys);
      } catch {
        setKeysError("Not JSON. Paste the single line the key script printed.");
        return;
      }
    }
    setKeysError(undefined);
    const ok = await writer.run(
      () =>
        consoleApi.setOidcClient(app.slug, {
          redirectUris: lines(redirectUris),
          postLogoutRedirectUris: lines(postLogout),
          jwks,
        }),
      (updated) =>
        updated.oidc.redirectUris.length > 0 && updated.oidc.jwks !== null
          ? `${updated.slug} can sign people in with Ward.`
          : `Saved. ${updated.slug} needs a redirect URI and a public key before it can sign anyone in with Ward.`,
    );
    if (ok) reload();
  }

  return (
    <Panel
      title="Sign in with Ward"
      note={
        isClient ? (
          <>
            This app is an OpenID Connect client: <Id>client_id</Id> is <Id>{app.slug}</Id>, and it
            authenticates with <Id>private_key_jwt</Id> using{" "}
            {kids.length === 1 ? "the key" : "one of the keys"} <Id>{kids.join(", ")}</Id>.
          </>
        ) : (
          <>
            Not set up. The app needs at least one redirect URI and its public key before its “Sign
            in with Ward” button can work. Until then Ward answers <Id>invalid_client</Id>.
          </>
        )
      }
    >
      {writer.error === undefined ? null : (
        <Alert tone="error" title="Ward refused the client settings" takeFocus>
          {writer.error}
        </Alert>
      )}
      <form
        className="wc-form"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <p className="wc-field">
          <label htmlFor={`oidc-redirect-${app.slug}`}>Redirect URIs, one per line</label>
          <textarea
            id={`oidc-redirect-${app.slug}`}
            rows={3}
            spellCheck={false}
            value={redirectUris}
            disabled={writer.busy}
            placeholder="https://example.com/app-api/auth/ward/callback"
            onChange={(event) => {
              setRedirectUris(event.target.value);
            }}
          />
          <span className="wc-field-hint">
            Exact strings, one per environment: the dev server’s (http on localhost is allowed) and
            the production one (https).
          </span>
        </p>
        <p className="wc-field">
          <label htmlFor={`oidc-logout-${app.slug}`}>Sign-out return URIs, one per line</label>
          <textarea
            id={`oidc-logout-${app.slug}`}
            rows={2}
            spellCheck={false}
            value={postLogout}
            disabled={writer.busy}
            placeholder="https://example.com/app/"
            onChange={(event) => {
              setPostLogout(event.target.value);
            }}
          />
          <span className="wc-field-hint">
            Where Ward may send someone after “sign out of Ward too”. Optional.
          </span>
        </p>
        <p className="wc-field">
          <label htmlFor={`oidc-keys-${app.slug}`}>Public key (JWK)</label>
          <textarea
            id={`oidc-keys-${app.slug}`}
            rows={3}
            spellCheck={false}
            value={keys}
            disabled={writer.busy}
            aria-invalid={keysError === undefined ? undefined : true}
            placeholder='{"kty":"OKP","crv":"Ed25519","x":"…","kid":"…"}'
            onChange={(event) => {
              setKeys(event.target.value);
            }}
          />
          <span className="wc-field-hint">
            The JSON line from <Id>npm run oidc-client-key --workspace=api -- {app.slug}</Id>. To
            rotate, paste a set — <Id>{'{"keys":[old, new]}'}</Id> — deploy the new key, then remove
            the old one. Empty removes every key and stops this app signing anyone in with Ward.
          </span>
          {keysError === undefined ? null : <span className="wc-field-error">{keysError}</span>}
        </p>
        <div className="wc-actions">
          <button type="submit" className="wc-btn" disabled={writer.busy}>
            Save client settings
          </button>
        </div>
      </form>
    </Panel>
  );
}
