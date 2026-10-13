import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `WARD_TRUSTED_PROXIES` (brief 28), in a child process for the reason
 * `config.mail.test.ts` gives: `config.ts` validates at import and exits. Unset
 * is a valid Ward that trusts loopback only; a malformed entry stops the boot
 * and names both the variable and the entry, because a typo here silently
 * widens or narrows whose `X-Forwarded-For` the login lockout believes.
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
  dir = mkdtempSync(join(tmpdir(), "ward-config-proxies-"));
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

describe("WARD_TRUSTED_PROXIES", () => {
  it.skipIf(tsxCli === undefined)("boots without it: loopback only", async () => {
    expect((await importConfig(baseEnv())).code).toBe(0);
  });

  it.skipIf(tsxCli === undefined)("boots with ranges and addresses, both families", async () => {
    for (const value of ["172.16.0.0/12", "10.87.92.0/24, fd00::/8, 192.0.2.1", ""]) {
      const result = await importConfig({ ...baseEnv(), WARD_TRUSTED_PROXIES: value });
      expect(result.code, `${value} ${result.stderr}`).toBe(0);
    }
  });

  it.skipIf(tsxCli === undefined)("refuses to boot on a malformed entry, naming it", async () => {
    for (const [value, entry] of [
      ["172.16.0.0/12, 172.16.0.0/33", "172.16.0.0/33"],
      ["docker0", "docker0"],
      ["0.0.0.0/0", "0.0.0.0/0"],
    ] as const) {
      const result = await importConfig({ ...baseEnv(), WARD_TRUSTED_PROXIES: value });
      expect(result.code, value).not.toBe(0);
      expect(result.stderr).toContain("WARD_TRUSTED_PROXIES");
      expect(result.stderr).toContain(JSON.stringify(entry));
    }
  });
});
