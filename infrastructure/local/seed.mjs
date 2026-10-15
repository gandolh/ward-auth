#!/usr/bin/env node
/**
 * Seed the local Ward (compose.yaml next to this file) and point the estate's
 * apps at it. Safe to re-run: everything is looked up before it is created.
 *
 *   node infrastructure/local/seed.mjs
 *
 * Signs in to the console with the break-glass login the container reads
 * (~/.config/ward/local.env, or $WARD_LOCAL_ENV_FILE), then makes sure that:
 *
 *   1. every app that uses Ward is registered;
 *   2. one owner account exists and holds `admin` on each of them;
 *   3. each app is an OpenID Connect client (brief 18): its dev redirect URI and
 *      sign-out return URI are registered, and its client key pair exists. The
 *      private half goes into the app's env file(s) as WARD_OIDC_CLIENT_KEY,
 *      next to WARD_OIDC_ISSUER, WARD_OIDC_CLIENT_ID, WARD_OIDC_REDIRECT_URI
 *      and WARD_OIDC_POST_LOGOUT_REDIRECT_URI; Ward gets only the public half.
 *      A key already in the env file and registered at Ward is kept, and
 *      nothing else in those files changes.
 *
 * It no longer writes WARD_APP_KEY, WARD_PUBLIC_ORIGIN or WARD_API_BASE_PATH:
 * those served the shared-cookie contract, retired in brief 30. An app env file
 * that still has them can simply drop the three lines; nothing reads them.
 *
 * The owner's username and password come from WARD_OWNER_USERNAME and
 * WARD_OWNER_PASSWORD, or are asked for. They go to Ward, which stores a hash,
 * and nowhere else: this script never writes them down.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/** Must match WARD_PUBLIC_ORIGIN in compose.yaml: Ward's own public origin. */
const ORIGIN = "http://localhost:8792";
const API_BASE_PATH = "/ward-api";
const API = `${ORIGIN}${API_BASE_PATH}`;
const OWNER_ROLE = "admin";
/** Must match WARD_OIDC_ISSUER in compose.yaml: it is the `iss` of every ID token. */
const OIDC_ISSUER = `${API}/oidc`;
/**
 * Where each app's "Sign in with Ward" comes back to: the shared library's
 * callback route (`<routePrefix>/ward/callback`, routePrefix `/auth`) under the
 * app's API prefix as the browser sees it. Under the API prefix because the
 * session cookie is scoped there and a link callback needs it, and because the
 * dev server and Caddy already route that prefix to the app's server: no new
 * proxy rule. An app that picks another path registers it in the console.
 */
const OIDC_CALLBACK_PATH = "/auth/ward/callback";
/** brief 18's convention, under the UI base path; replaced by the one above. */
const OLD_OIDC_CALLBACK_PATH = "auth/ward/callback";

const ENV_FILE = process.env.WARD_LOCAL_ENV_FILE ?? join(homedir(), ".config/ward/local.env");

/** The directory holding the estate's repos, i.e. wzd_auth's parent. */
const PROJECTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The apps that authenticate against Ward. `slug` is Ward's `apps.slug`, `repo`
 * the checkout under PROJECTS, and `envFiles` the gitignored files holding that
 * app's local Ward settings, relative to the repo. `dev` is the app's dev
 * server URL with its base path, where Ward returns after "sign out of Ward
 * too"; `api` is the API prefix that dev server proxies to the app's server,
 * which the OIDC redirect URI hangs off.
 */
const APPS = [
  { slug: "atrium", name: "Atrium", repo: "atrium", envFiles: [".env"], dev: "http://localhost:5173/atrium/", api: "/atrium-api" },
  { slug: "newspapper", name: "Newspapper", repo: "newspapper", envFiles: [".env"], dev: "http://localhost:4321/newspapper/", api: "/newspapper/api" },
  { slug: "prm", name: "Public Resource Map", repo: "public-resource-map", envFiles: [".env"], dev: "http://localhost:5173/prm/", api: "/prm-api" },
  { slug: "sports-app", name: "Sports", repo: "sports-app", envFiles: [".env"], dev: "http://localhost:5173/sports-app/", api: "/api" },
  { slug: "satchel", name: "Satchel", repo: "satchel", envFiles: [".env"], dev: "http://localhost:5175/satchel/", api: "/satchel-api" },
  { slug: "shelfmark", name: "Shelfmark", repo: "shelfmark", envFiles: [".env"], dev: "http://localhost:5176/shelfmark/", api: "/shelfmark-api" },
];

async function main() {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`${ENV_FILE} does not exist. README.md next to this script says what goes in it.`);
  }
  process.loadEnvFile(ENV_FILE);
  const { WARD_ADMIN_USERNAME, WARD_ADMIN_PASSWORD } = process.env;
  if (!WARD_ADMIN_USERNAME || !WARD_ADMIN_PASSWORD) {
    throw new Error(`${ENV_FILE} must set WARD_ADMIN_USERNAME and WARD_ADMIN_PASSWORD.`);
  }

  const owner = await ownerCredentials();
  await waitForWard();

  const login = await ward("POST", "/console/login", {
    body: { username: WARD_ADMIN_USERNAME, password: WARD_ADMIN_PASSWORD },
  });
  expectStatus(login, 200, "console sign-in");
  const cookie = login.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .find((pair) => pair.startsWith("ward_console="));
  if (!cookie) throw new Error("console sign-in answered 200 but set no ward_console cookie");

  try {
    await ensureApps(cookie);
    const account = await ensureOwner(cookie, owner);
    await ensureGrants(cookie, account.subject);
    for (const app of APPS) await ensureOidcClient(cookie, app);
  } finally {
    await ward("POST", "/console/logout", { cookie });
  }
}

async function ensureApps(cookie) {
  const { apps } = expectStatus(await ward("GET", "/console/apps", { cookie }), 200, "list apps");
  const registered = new Set(apps.map((app) => app.slug));
  for (const app of APPS) {
    if (registered.has(app.slug)) continue;
    const created = await ward("POST", "/console/apps", {
      cookie,
      body: { slug: app.slug, name: app.name },
    });
    expectStatus(created, 201, `register ${app.slug}`);
    console.log(`  registered app "${app.slug}"`);
  }
  console.log(`✓ apps: ${APPS.map((app) => app.slug).join(", ")}`);
}

async function ensureOwner(cookie, { username, password }) {
  let account = await findAccount(cookie, username);
  if (account) {
    // Deliberately not reset: re-running must not undo a password changed since.
    console.log(`✓ owner account "${account.username}" already exists (password left as it is)`);
  } else {
    const created = await ward("POST", "/console/accounts", { cookie, body: { username, password } });
    account = expectStatus(created, 201, `create account "${username}"`).account;
    console.log(`✓ owner account "${account.username}" created`);
  }
  if (account.disabled) console.warn(`! "${account.username}" is disabled; enable it in the console`);
  return account;
}

async function findAccount(cookie, username) {
  const wanted = username.toLowerCase();
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await ward("GET", `/console/accounts?limit=${limit}&offset=${offset}`, { cookie });
    const { accounts } = expectStatus(page, 200, "list accounts");
    const match = accounts.find((account) => account.username.toLowerCase() === wanted);
    if (match || accounts.length < limit) return match;
  }
}

async function ensureGrants(cookie, subject) {
  for (const app of APPS) {
    const granted = await ward("POST", "/console/grants", {
      cookie,
      body: { subject, appSlug: app.slug, role: OWNER_ROLE },
    });
    expectStatus(granted, 200, `grant ${app.slug}:${OWNER_ROLE}`);
  }
  console.log(`✓ grants: ${OWNER_ROLE} on all ${APPS.length} apps`);
}

/** The app's env files that are safe to write a secret into, or [] to skip it. */
function envFilesFor(app) {
  const repoDir = join(PROJECTS, app.repo);
  if (!existsSync(repoDir)) {
    console.log(`- ${app.slug}: no ${app.repo}/ next to wzd_auth, skipped`);
    return [];
  }

  const files = [];
  for (const file of app.envFiles.map((path) => join(repoDir, path))) {
    if (ignoredByGit(repoDir, file)) files.push(file);
    else console.warn(`! ${relative(PROJECTS, file)} is not gitignored; not writing a key into it`);
  }
  return files;
}

/**
 * Register the app as an OIDC client and give it a key pair. Redirect URIs and
 * keys already registered (say, added by hand in the console) are kept; the
 * dev ones are added beside them.
 */
async function ensureOidcClient(cookie, app) {
  const files = envFilesFor(app);
  if (files.length === 0) return;

  const { app: registered } = expectStatus(
    await ward("GET", `/console/apps/${app.slug}`, { cookie }),
    200,
    `read ${app.slug}`,
  );
  const known = registered.oidc.jwks?.keys ?? [];

  let envKey = files.map((file) => readEnvValue(file, "WARD_OIDC_CLIENT_KEY")).find(Boolean);
  let publicJwk = envKey ? publicHalf(envKey) : undefined;
  let outcome = "kept";
  if (!publicJwk || !known.some((key) => key.kid === publicJwk.kid && key.x === publicJwk.x)) {
    ({ envKey, publicJwk } = newClientKey());
    outcome = "minted";
  }

  const redirect = `${new URL(app.dev).origin}${app.api}${OIDC_CALLBACK_PATH}`;
  const stale = `${app.dev}${OLD_OIDC_CALLBACK_PATH}`;
  const body = {
    redirectUris: [
      ...new Set([...registered.oidc.redirectUris.filter((uri) => uri !== stale), redirect]),
    ],
    postLogoutRedirectUris: [...new Set([...registered.oidc.postLogoutRedirectUris, app.dev])],
    jwks: {
      keys: [...known.filter((key) => key.kid !== publicJwk.kid), publicJwk],
    },
  };
  expectStatus(
    await ward("PUT", `/console/apps/${app.slug}/oidc`, { cookie, body }),
    200,
    `register ${app.slug} as an OIDC client`,
  );

  for (const file of files) {
    writeEnvValues(file, {
      WARD_OIDC_ISSUER: OIDC_ISSUER,
      WARD_OIDC_CLIENT_ID: app.slug,
      WARD_OIDC_CLIENT_KEY: envKey,
      WARD_OIDC_REDIRECT_URI: redirect,
      WARD_OIDC_POST_LOGOUT_REDIRECT_URI: app.dev,
    });
  }
  console.log(`✓ ${app.slug}: OIDC client, key ${outcome} (kid ${publicJwk.kid.slice(0, 8)}…), ${redirect}`);
}

/**
 * The same pair `npm run oidc-client-key` prints (api/src/oidc/client-keygen.ts),
 * made here with node:crypto alone because this script has no dependencies.
 */
function newClientKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const { crv, x, d } = privateKey.export({ format: "jwk" });
  const publicJwk = { kty: "OKP", crv, x, kid: thumbprint(crv, x), use: "sig" };
  const envKey = Buffer.from(JSON.stringify({ ...publicJwk, d })).toString("base64url");
  return { envKey, publicJwk };
}

/** The public JWK inside a WARD_OIDC_CLIENT_KEY value, or undefined if it is not one. */
function publicHalf(envKey) {
  try {
    const { kty, crv, x, kid } = JSON.parse(Buffer.from(envKey, "base64url").toString("utf8"));
    if (kty !== "OKP" || crv !== "Ed25519" || typeof x !== "string") return undefined;
    return { kty, crv, x, kid: kid ?? thumbprint(crv, x), use: "sig" };
  } catch {
    return undefined;
  }
}

/** RFC 7638: sha256 over the required members in lexical order. */
function thumbprint(crv, x) {
  return createHash("sha256").update(JSON.stringify({ crv, kty: "OKP", x })).digest("base64url");
}

async function ward(method, path, { body, cookie } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json, headers: response.headers };
}

function expectStatus(answer, status, what) {
  if (answer.status !== status) {
    throw new Error(`${what}: Ward answered ${answer.status} ${answer.json?.error ?? ""}`.trim());
  }
  return answer.json;
}

async function waitForWard() {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`nothing answers at ${API}/health. Start it: cd infrastructure/local && docker compose up -d`);
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
}

/** `git check-ignore` exits 0 for an ignored path, 1 for one git would track. */
function ignoredByGit(repoDir, file) {
  try {
    execFileSync("git", ["-C", repoDir, "check-ignore", "-q", "--", relative(repoDir, file)], {
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    // 128: not a git checkout at all, so there is nothing to leak the key into.
    return error.status === 128;
  }
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function readEnvValue(file, name) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (match && match[1] === name) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** Replace each variable's line in place; append the ones the file lacks. */
function writeEnvValues(file, values) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = new Set(Object.keys(values));
  const lines = text.split("\n").map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match || !(match[1] in values)) return line;
    missing.delete(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  let out = lines.join("\n");
  if (missing.size > 0) {
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out +=
      "\n# Ward, for LOCAL runs: the container in wzd_auth/infrastructure/local,\n" +
      "# written by its seed.mjs. Production gets these from vps-deploy.\n" +
      [...missing].map((name) => `${name}=${values[name]}`).join("\n") +
      "\n";
  }
  // `mode` only applies when the file is created; an existing file keeps its own.
  writeFileSync(file, out, { mode: 0o600 });
}

async function ownerCredentials() {
  let username = process.env.WARD_OWNER_USERNAME?.trim();
  let password = process.env.WARD_OWNER_PASSWORD;
  if (username && password) return { username, password };
  if (!process.stdin.isTTY) {
    throw new Error("set WARD_OWNER_USERNAME and WARD_OWNER_PASSWORD, or run this in a terminal to be asked");
  }
  if (!username) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    username = (await prompt.question("Owner account username: ")).trim();
    prompt.close();
  }
  if (!password) password = await askHidden("Owner account password: ");
  if (!username || !password) throw new Error("the owner account needs a username and a password");
  return { username, password };
}

/** Read a line from the terminal without echoing it. */
function askHidden(question) {
  const { stdin, stdout } = process;
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((done) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          done(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
}

try {
  await main();
} catch (error) {
  console.error(`seed: ${error.message}`);
  process.exit(1);
}
