import { generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import { calculateJwkThumbprint } from "jose";

/**
 * Generate an app's OIDC client key pair (brief 18).
 *
 *   npm run oidc-client-key --workspace=api -- <app-slug>
 *
 * Prints two things and writes nothing:
 *
 *  1. `WARD_OIDC_CLIENT_KEY=…`, the line the **app** puts in its environment.
 *     The value is the private JWK (`kty`, `crv`, `x`, `d`, `kid`, `use`) as
 *     JSON, base64url-encoded so it survives every env-file parser
 *     as one unquoted token. It is the app's credential: it stays with the app.
 *  2. The **public** JWK, for Ward's console (Apps → the app → Sign in with
 *     Ward). Ward stores only this, and refuses a key carrying `d`.
 *
 * Nothing is written to disk on purpose: a key file would be one more place to
 * leak it from, and the operator is going to paste both halves somewhere else
 * anyway. Run it again for a new key; registering the new public key next to
 * the old one in the console lets the app switch without a window of failure.
 */

export interface ClientKeyPair {
  /** The private JWK, for the app. */
  privateJwk: Record<string, string>;
  /** The public JWK, for Ward. */
  publicJwk: Record<string, string>;
  /** `privateJwk` as the env value: base64url(JSON). */
  envValue: string;
}

export const CLIENT_KEY_ENV = "WARD_OIDC_CLIENT_KEY";

export async function generateClientKeyPair(): Promise<ClientKeyPair> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { crv: string; x: string; d: string };
  const kid = await calculateJwkThumbprint({ kty: "OKP", crv: jwk.crv, x: jwk.x });

  // No `alg`: an Ed25519 key signs as `EdDSA` or `Ed25519` depending on the
  // library, and Ward accepts both (`CLIENT_ASSERTION_ALGS` in clients.ts).
  const publicJwk = { kty: "OKP", crv: jwk.crv, x: jwk.x, kid, use: "sig" };
  const privateJwk = { ...publicJwk, d: jwk.d };
  return {
    privateJwk,
    publicJwk,
    envValue: Buffer.from(JSON.stringify(privateJwk), "utf8").toString("base64url"),
  };
}

/** Decode a `WARD_OIDC_CLIENT_KEY` value back into the private JWK. */
export function decodeClientKey(envValue: string): Record<string, string> {
  return JSON.parse(Buffer.from(envValue, "base64url").toString("utf8")) as Record<string, string>;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (slug === undefined || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error("usage: npm run oidc-client-key --workspace=api -- <app-slug>");
    process.exit(2);
  }
  const pair = await generateClientKeyPair();
  console.log(
    [
      `# ${slug}: Ward OIDC client key, generated ${new Date().toISOString()}`,
      "#",
      "# 1. The app's environment (its gitignored .env, or the deploy's secrets).",
      "#    This is the app's private key. Never commit it and never paste it into Ward.",
      `${CLIENT_KEY_ENV}=${pair.envValue}`,
      "#",
      `# 2. Ward's console: Apps → ${slug} → Sign in with Ward → public key.`,
      JSON.stringify(pair.publicJwk),
    ].join("\n"),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
