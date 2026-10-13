import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `npm run vendor` end to end: build, copy into a scratch directory, and then
 * use the copy the way an app would — a plain `.mjs` Fastify server on
 * `node:sqlite` importing `./ward-auth.js` by relative path, and a TypeScript
 * consumer type-checking against the two `.d.ts` files.
 *
 * The scratch directory sits under `shared-library/.scratch/` (gitignored)
 * rather than the OS temp directory, so the smoke server resolves `fastify`
 * the way an app does: from a `node_modules` above it. The copy itself brings
 * nothing to install.
 */

const run = promisify(execFile);
const LIBRARY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = join(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin",
  "tsc",
);

const SIX = [
  "LICENSE",
  "README.md",
  "ward-auth-react.d.ts",
  "ward-auth-react.js",
  "ward-auth.d.ts",
  "ward-auth.js",
];

let scratch: string;
let copy: string;

beforeAll(async () => {
  await mkdir(join(LIBRARY_ROOT, ".scratch"), { recursive: true });
  scratch = await mkdtemp(join(LIBRARY_ROOT, ".scratch", "vendor-"));
  copy = join(scratch, "vendor", "ward");
  await run(process.execPath, [join(LIBRARY_ROOT, "scripts", "vendor.mjs"), copy], {
    cwd: LIBRARY_ROOT,
  });
}, 60_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("the vendored copy", () => {
  it("holds exactly the six files", async () => {
    expect((await readdir(copy)).sort()).toEqual(SIX);
  });

  it("has a README naming the version, the source and the upgrade notes", async () => {
    const readme = await readFile(join(copy, "README.md"), "utf8");
    const { version } = JSON.parse(await readFile(join(LIBRARY_ROOT, "package.json"), "utf8")) as {
      version: string;
    };

    expect(readme).toContain(version);
    expect(readme).toContain("https://github.com/gandolh/ward-auth");
    expect(readme).toContain("`shared-library/`");
    expect(readme).toContain(
      "https://github.com/gandolh/ward-auth/blob/main/shared-library/CHANGELOG.md",
    );
  });

  /**
   * No local path and no domain. The production domain is not written here
   * either; instead every URL must be on an allowed host. The README allows
   * only GitHub. The bundles' doc comments may also use the reserved
   * `example.com` and `localhost` in examples, and nothing else.
   */
  it("names no local path and no domain other than the source repository's", async () => {
    const examples = ["github.com", "example.com", "localhost"];
    const allowed: Record<string, string[]> = {
      "README.md": ["github.com"],
      "ward-auth.js": examples,
      "ward-auth-react.js": examples,
      "ward-auth.d.ts": examples,
      "ward-auth-react.d.ts": examples,
    };
    for (const [name, hosts] of Object.entries(allowed)) {
      const text = await readFile(join(copy, name), "utf8");
      expect(text, name).not.toContain(LIBRARY_ROOT);
      expect(text, name).not.toMatch(/\/home\/|\/Users\/|[A-Z]:\\|file:\/\/|\.scratch/);
      for (const match of text.matchAll(/https?:\/\/([^/:\s)`'",]+)/g)) {
        expect(hosts, `${name}: ${match[0]}`).toContain(match[1]);
      }
    }
  });

  it("carries the MIT licence", async () => {
    expect(await readFile(join(copy, "LICENSE"), "utf8")).toMatch(/^MIT License/);
  });

  it("imports nothing at runtime but node: built-ins (server) and react (hooks)", async () => {
    const server = await readFile(join(copy, "ward-auth.js"), "utf8");
    const hooks = await readFile(join(copy, "ward-auth-react.js"), "utf8");
    const specifiers = (code: string) =>
      [...code.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

    expect(specifiers(server).every((s) => s!.startsWith("node:"))).toBe(true);
    expect(specifiers(hooks)).toEqual(["react"]);
    // Readable on purpose: not minified, comments kept.
    expect(server).toContain("spendDummyHash");
    expect(server).toMatch(/\/\*\*\n \* /);
  });

  it("has self-contained declaration files an app's TypeScript accepts", async () => {
    for (const name of ["ward-auth.d.ts", "ward-auth-react.d.ts"]) {
      expect(await readFile(join(copy, name), "utf8"), name).not.toMatch(/from ['"]\.\.?\//);
    }

    await writeFile(
      join(scratch, "consumer.ts"),
      `import { createAccounts, createSqliteStore, wardAuth, type AuthContext } from "./vendor/ward/ward-auth.js";
import { configureAuth, useSession, type SessionState } from "./vendor/ward/ward-auth-react.js";
import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";

const accounts = createAccounts({ store: createSqliteStore(new Database(":memory:")) });
createSqliteStore(new DatabaseSync(":memory:"));
const app = Fastify();
void app.register(wardAuth, { accounts, cookieName: "x_session", cookiePath: "/api", publicOrigin: "https://example.com" });
app.get("/me", async (request) => {
  const auth: AuthContext | null = request.auth;
  return { user: auth?.user.username ?? null };
});
configureAuth({ basePath: "/api/auth" });
export type Probe = [SessionState, typeof useSession];
`,
    );
    await run(
      process.execPath,
      [
        TSC,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "--types",
        "node",
        "--skipLibCheck",
        "false",
        join(scratch, "consumer.ts"),
      ],
      { cwd: scratch },
    ).catch((error: { stdout?: string; stderr?: string }) => {
      throw new Error(
        `tsc rejected the vendored types:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
      );
    });
  }, 60_000);

  it("runs in a plain .mjs Fastify server on node:sqlite, imported by relative path", async () => {
    await writeFile(
      join(scratch, "server.mjs"),
      `import Fastify from "fastify";
import { DatabaseSync } from "node:sqlite";
import { createAccounts, createSqliteStore, seedUsers, wardAuth } from "./vendor/ward/ward-auth.js";

const accounts = createAccounts({ store: createSqliteStore(new DatabaseSync(":memory:")) });
await seedUsers(accounts, [{ username: "smoke", password: "smoke test password", role: "member" }]);

const app = Fastify();
await app.register(wardAuth, {
  accounts,
  cookieName: "smoke_session",
  cookiePath: "/api",
  publicOrigin: "http://localhost:3000",
  routePrefix: "/api/auth",
});
app.get("/api/secret", async (request) => ({ user: request.auth.user.username }));
await app.listen({ port: 0, host: "127.0.0.1" });

const base = "http://127.0.0.1:" + app.server.address().port;
const denied = await fetch(base + "/api/secret");
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "smoke", password: "smoke test password" }),
});
const cookie = login.headers.get("set-cookie").split(";")[0];
const secret = await fetch(base + "/api/secret", { headers: { cookie } });
console.log(JSON.stringify({ denied: denied.status, login: login.status, secret: await secret.json() }));
await app.close();
`,
    );

    const { stdout } = await run(process.execPath, ["--no-warnings", join(scratch, "server.mjs")], {
      cwd: scratch,
    });
    expect(JSON.parse(stdout.trim())).toEqual({
      denied: 401,
      login: 200,
      secret: { user: "smoke" },
    });
  }, 60_000);

  it("overwrites an existing copy on upgrade, and refuses a directory holding anything else", async () => {
    await run(process.execPath, [join(LIBRARY_ROOT, "scripts", "vendor.mjs"), copy], {
      cwd: LIBRARY_ROOT,
    });
    expect((await readdir(copy)).sort()).toEqual(SIX);

    await writeFile(join(copy, "notes.txt"), "an app's own file");
    await expect(
      run(process.execPath, [join(LIBRARY_ROOT, "scripts", "vendor.mjs"), copy], {
        cwd: LIBRARY_ROOT,
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("notes.txt") });
  }, 60_000);
});
