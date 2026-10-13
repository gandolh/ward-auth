import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The OIDC half of the environment contract (brief 18), in a child process for
 * the reason `config.mail.test.ts` gives: `config.ts` validates at import and
 * exits. The property under test is the file's own — a wrong value stops the
 * boot and names the variable — plus the one this brief adds: leaving the
 * issuer unset is a valid Ward that simply does not mount the provider.
 */
const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HERE, "..", "..");
const configPath = join(HERE, "config.ts");
const tsxCli = (() => {
  const candidate = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  return existsSync(candidate) ? candidate : undefined;
})();

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ward-config-oidc-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseEnv(): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    PORT: "8799",
    HOST: "127.0.0.1",
    WARD_DB_PATH: join(dir, "child.db"),
    WARD_ADMIN_USERNAME: "root",
    WARD_ADMIN_PASSWORD: "break-glass",
    WARD_SIGNING_KEY_PATH: join(dir, "signing-key.pem"),
    WARD_PUBLIC_ORIGIN: "https://example.com",
    WARD_MAIL_TRANSPORT: "file",
    WARD_MAIL_FILE_DIR: join(dir, "outbox"),
    WARD_MAIL_FROM: "ward@example.com",
  };
}

async function importConfig(
  env: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await promisify(execFile)(process.execPath, [tsxCli!, configPath], {
      env,
      cwd: REPO_ROOT,
    });
    return { code: 0, stderr };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? -1, stderr: failure.stderr ?? "" };
  }
}

describe("WARD_OIDC_ISSUER and WARD_UI_URL", () => {
  it.skipIf(tsxCli === undefined)("boots with neither: the provider is simply off", async () => {
    expect((await importConfig(baseEnv())).code).toBe(0);
  });

  it.skipIf(tsxCli === undefined)("boots with both, behind a prefix or direct", async () => {
    for (const [issuer, ui] of [
      ["https://example.com/ward-api/oidc", "https://example.com/ward"],
      ["https://example.com/ward-api/oidc/", "https://example.com/ward/"],
      ["http://localhost:8791/oidc", "http://localhost:8791/ward"],
    ] as const) {
      const result = await importConfig({
        ...baseEnv(),
        WARD_OIDC_ISSUER: issuer,
        WARD_UI_URL: ui,
      });
      expect(result.code, `${issuer} ${result.stderr}`).toBe(0);
    }
  });

  it.skipIf(tsxCli === undefined)("refuses an issuer that does not end in /oidc", async () => {
    const result = await importConfig({
      ...baseEnv(),
      WARD_OIDC_ISSUER: "https://example.com/ward-api",
      WARD_UI_URL: "https://example.com/ward",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("WARD_OIDC_ISSUER");
  });

  it.skipIf(tsxCli === undefined)(
    "refuses an issuer with a query or an upper-case host",
    async () => {
      for (const issuer of ["https://example.com/ward-api/oidc?x=1", "https://Example.com/oidc"]) {
        const result = await importConfig({
          ...baseEnv(),
          WARD_OIDC_ISSUER: issuer,
          WARD_UI_URL: "https://example.com/ward",
        });
        expect(result.code, issuer).toBe(1);
        expect(result.stderr).toContain("WARD_OIDC_ISSUER");
      }
    },
  );

  it.skipIf(tsxCli === undefined)(
    "requires the UI URL with an issuer, on the same origin",
    async () => {
      const missing = await importConfig({
        ...baseEnv(),
        WARD_OIDC_ISSUER: "https://example.com/ward-api/oidc",
      });
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("WARD_UI_URL");

      const elsewhere = await importConfig({
        ...baseEnv(),
        WARD_OIDC_ISSUER: "https://example.com/ward-api/oidc",
        WARD_UI_URL: "https://ward.example.net/ward",
      });
      expect(elsewhere.code).toBe(1);
      expect(elsewhere.stderr).toContain("WARD_UI_URL");
    },
  );
});
