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
 *   3. each app has a working app key, written together with WARD_PUBLIC_ORIGIN
 *      and WARD_API_BASE_PATH into that app's local env file(s). Nothing else in
 *      those files changes, and a key that still works is kept.
 *
 * The owner's username and password come from WARD_OWNER_USERNAME and
 * WARD_OWNER_PASSWORD, or are asked for. They go to Ward, which stores a hash,
 * and nowhere else: this script never writes them down.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/** Must match WARD_PUBLIC_ORIGIN in compose.yaml: it is the `iss` apps expect. */
const ORIGIN = "http://localhost:8792";
const API_BASE_PATH = "/ward-api";
const API = `${ORIGIN}${API_BASE_PATH}`;
const OWNER_ROLE = "admin";
const KEY_LABEL = "local dev (seed.mjs)";

const ENV_FILE = process.env.WARD_LOCAL_ENV_FILE ?? join(homedir(), ".config/ward/local.env");

/** The directory holding the estate's repos, i.e. wzd_auth's parent. */
const PROJECTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The apps that authenticate against Ward. `slug` is Ward's `apps.slug`, `repo`
 * the checkout under PROJECTS, and `envFiles` the gitignored files holding that
 * app's local Ward settings, relative to the repo.
 */
const APPS = [
  { slug: "atrium", name: "Atrium", repo: "atrium", envFiles: [".env"] },
  { slug: "newspapper", name: "Newspapper", repo: "newspapper", envFiles: [".env"] },
  { slug: "prm", name: "Public Resource Map", repo: "public-resource-map", envFiles: [".env"] },
  { slug: "sports-app", name: "Sports", repo: "sports-app", envFiles: [".env"] },
  {
    slug: "imbatranim-os",
    name: "ImbatranimOS",
    repo: "imbatranimOS",
    // Nest loads .env from its working directory, apps/backend.
    envFiles: [".env", "apps/backend/.env"],
  },
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
    for (const app of APPS) await ensureAppKey(cookie, app);
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

async function ensureAppKey(cookie, app) {
  const repoDir = join(PROJECTS, app.repo);
  if (!existsSync(repoDir)) {
    console.log(`- ${app.slug}: no ${app.repo}/ next to wzd_auth, skipped`);
    return;
  }

  const files = [];
  for (const file of app.envFiles.map((path) => join(repoDir, path))) {
    if (ignoredByGit(repoDir, file)) files.push(file);
    else console.warn(`! ${relative(PROJECTS, file)} is not gitignored; not writing a key into it`);
  }
  if (files.length === 0) return;

  let key = files.map((file) => readEnvValue(file, "WARD_APP_KEY")).find(Boolean);
  let outcome = "kept";
  if (!key || !(await appKeyWorks(key))) {
    const minted = await ward("POST", `/console/apps/${app.slug}/keys`, {
      cookie,
      body: { label: KEY_LABEL },
    });
    key = expectStatus(minted, 201, `mint a key for ${app.slug}`).key;
    outcome = "minted";
  }

  for (const file of files) {
    writeEnvValues(file, {
      WARD_PUBLIC_ORIGIN: ORIGIN,
      WARD_API_BASE_PATH: API_BASE_PATH,
      WARD_APP_KEY: key,
    });
  }
  // A prefix only. The key is a secret, and a terminal scrollback is one more
  // place for it to leak from.
  const where = files.map((file) => relative(PROJECTS, file)).join(", ");
  console.log(`✓ ${app.slug}: key ${outcome} (${key.slice(0, 12)}…) → ${where}`);
}

/** `/introspect` checks the app key before anything else, so a bad one is a 401. */
async function appKeyWorks(key) {
  const answer = await ward("POST", "/introspect", { appKey: key, body: {} });
  return answer.status === 200;
}

async function ward(method, path, { body, cookie, appKey } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (appKey) headers["x-ward-app-key"] = appKey;

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
