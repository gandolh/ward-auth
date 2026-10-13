import type Database from "better-sqlite3";

/**
 * Brief 18 — Ward as an OpenID Connect provider.
 *
 * Three things, one migration, because none of them means anything without the
 * others:
 *
 *  1. **Client metadata on `apps`.** A client is an app (`client_id` is the
 *     slug), so its redirect URIs and its public key live on the app's row
 *     rather than in a parallel registry that could disagree with it about
 *     which apps exist. Deleting an app deletes its client with it.
 *  2. **`oidc_payloads`**, the provider's storage. `oidc-provider` keeps codes,
 *     sessions, interactions, grants and replay markers through an adapter, and
 *     its default adapter is an in-process map: a restart mid-flow would lose
 *     the code a person was about to be redirected with.
 *  3. **`oidc_authorizations`**, the bridge from a provider grant to Ward's
 *     own session. It is how the ID token learns `ward_sid` and `ward_role`.
 *
 * Every time is epoch seconds, not ISO text like the rest of the schema,
 * because `oidc-provider` deals in epoch seconds throughout and translating at
 * the adapter boundary would be one more place to get a unit wrong.
 */
export function up(db: Database.Database): void {
  // The JSON columns carry CHECKs so a hand edit cannot store something the
  // adapter would then hand the provider as client metadata. `[]` is "not
  // registered": an app with no redirect URI is not an OIDC client at all.
  db.exec(`
    ALTER TABLE apps ADD COLUMN oidc_redirect_uris TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(oidc_redirect_uris) AND json_type(oidc_redirect_uris) = 'array')
  `);
  db.exec(`
    ALTER TABLE apps ADD COLUMN oidc_post_logout_redirect_uris TEXT NOT NULL DEFAULT '[]'
      CHECK (
        json_valid(oidc_post_logout_redirect_uris)
        AND json_type(oidc_post_logout_redirect_uris) = 'array'
      )
  `);
  // The app's PUBLIC keys, as a JWK Set. Never a private key and never a
  // secret: the app signs a client assertion with a key only it holds, so Ward
  // stores nothing that would let anyone act as the app (decisions-oidc.md).
  db.exec(`
    ALTER TABLE apps ADD COLUMN oidc_jwks TEXT
      CHECK (oidc_jwks IS NULL OR (json_valid(oidc_jwks) AND json_type(oidc_jwks, '$.keys') = 'array'))
  `);

  db.exec(`
    CREATE TABLE oidc_payloads (
      -- The provider's model name: Session, Interaction, AuthorizationCode,
      -- Grant, AccessToken, ReplayDetection, ... The id space is per model.
      model       TEXT    NOT NULL,
      id          TEXT    NOT NULL,
      payload     TEXT    NOT NULL CHECK (json_valid(payload)),

      -- Secondary lookups the adapter contract asks for, lifted out of the
      -- payload so each is an index seek.
      grant_id    TEXT,
      uid         TEXT,
      user_code   TEXT,

      -- Epoch seconds. NULL means the provider gave no lifetime, which in
      -- practice never happens for a model Ward enables; the sweep leaves such
      -- a row alone rather than guessing.
      expires_at  INTEGER,
      consumed_at INTEGER,

      PRIMARY KEY (model, id),
      CHECK (model <> ''),
      CHECK (id <> '')
    ) STRICT
  `);
  db.exec(
    `CREATE INDEX oidc_payloads_grant_idx ON oidc_payloads (grant_id) WHERE grant_id IS NOT NULL`,
  );
  db.exec(`CREATE INDEX oidc_payloads_uid_idx ON oidc_payloads (model, uid) WHERE uid IS NOT NULL`);
  db.exec(
    `CREATE INDEX oidc_payloads_user_code_idx ON oidc_payloads (model, user_code) WHERE user_code IS NOT NULL`,
  );
  db.exec(`CREATE INDEX oidc_payloads_expiry_idx ON oidc_payloads (expires_at)`);

  db.exec(`
    CREATE TABLE oidc_authorizations (
      -- The provider's Grant id. One row per authorization: the interaction
      -- creates a fresh grant every time, because it runs every time.
      grant_id   TEXT    NOT NULL PRIMARY KEY,
      client_id  TEXT    NOT NULL REFERENCES apps (slug) ON DELETE CASCADE,
      subject    TEXT    NOT NULL REFERENCES users (subject) ON DELETE CASCADE,
      -- The Ward refresh family this authorization rode on: ward_sid. Not a
      -- foreign key, because refresh_tokens' key is the token hash, not the
      -- family, and a family is a set of rows rather than one.
      family_id  TEXT    NOT NULL,
      -- The role the grant named when the interaction ran: ward_role.
      role       TEXT    NOT NULL,
      expires_at INTEGER NOT NULL,

      CHECK (grant_id <> ''),
      CHECK (family_id <> ''),
      CHECK (role <> '')
    ) STRICT
  `);
  db.exec(`CREATE INDEX oidc_authorizations_expiry_idx ON oidc_authorizations (expires_at)`);
}
