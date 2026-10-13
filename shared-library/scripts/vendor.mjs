/**
 * `npm run vendor -- <target dir>` — build, then write a vendored copy.
 *
 * A copy holds exactly six files (decisions-oidc.md, "What a copy holds"):
 * the two bundles, their two declaration files, a README and the LICENSE. No
 * source maps, no `package.json`: an app imports `./vendor/ward/ward-auth.js`
 * by relative path and has nothing to install.
 *
 * The README is generated here, and it names the version, the source
 * repository and where the upgrade notes are — and nothing else. **No local
 * path and no domain**: a copy lives in another repository, where a path on
 * the machine that built it means nothing and a domain is configuration.
 *
 * The target is resolved against the directory `npm` was invoked from
 * (`INIT_CWD`), not against `shared-library/`, which is where npm runs a
 * workspace script.
 *
 * Upgrading an app means running this over its existing `vendor/ward/`. The
 * six files are overwritten; anything else found there is refused rather than
 * deleted, because it is either an app's edit to a vendored file's neighbour
 * or a mistyped target, and neither should be removed silently.
 */

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DIST, LIBRARY_ROOT, build, readVersion } from "./build.mjs";

export const SOURCE_REPOSITORY = "https://github.com/gandolh/ward-auth";
export const CHANGELOG_URL = `${SOURCE_REPOSITORY}/blob/main/shared-library/CHANGELOG.md`;

/** The whole of a vendored copy. */
export const VENDORED_FILES = [
  "LICENSE",
  "README.md",
  "ward-auth-react.d.ts",
  "ward-auth-react.js",
  "ward-auth.d.ts",
  "ward-auth.js",
];

export function vendorReadme(version) {
  return `# ward-auth ${version} (vendored)

This directory is a built copy of ward-auth, the shared library for the
estate's apps: local accounts, and "Sign in with Ward". It is generated: do not edit these files. To upgrade,
build a newer version and copy it over this one, then follow the upgrade notes.

- **Version:** ${version}
- **Source:** ${SOURCE_REPOSITORY}, folder \`shared-library/\`
- **Upgrade notes:** ${CHANGELOG_URL}

| File | What it is |
|---|---|
| \`ward-auth.js\` | Server bundle: accounts, sessions, lockout, SQLite store, Sign in with Ward, Fastify plugin |
| \`ward-auth.d.ts\` | Its types |
| \`ward-auth-react.js\` | Browser bundle: unstyled React hooks |
| \`ward-auth-react.d.ts\` | Its types |
| \`LICENSE\` | MIT |

Import the bundles by relative path. Fastify and React come from the app's own
dependencies; nothing here needs installing.
`;
}

/** Build and write a copy into `targetDir`. Returns the files written. */
export async function vendor(targetDir) {
  const version = await readVersion();
  await build();

  await mkdir(targetDir, { recursive: true });
  const strays = (await readdir(targetDir)).filter((name) => !VENDORED_FILES.includes(name));
  if (strays.length > 0) {
    throw new Error(
      `refusing to vendor into ${targetDir}: it holds files that are not part of a copy ` +
        `(${strays.join(", ")}). Remove them, or pick the right directory.`,
    );
  }

  for (const name of [
    "ward-auth.js",
    "ward-auth.d.ts",
    "ward-auth-react.js",
    "ward-auth-react.d.ts",
  ]) {
    await copyFile(join(DIST, name), join(targetDir, name));
  }
  await copyFile(join(LIBRARY_ROOT, "LICENSE"), join(targetDir, "LICENSE"));
  await writeFile(join(targetDir, "README.md"), vendorReadme(version));

  return VENDORED_FILES.map((name) => join(targetDir, name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (target === undefined || target.length === 0) {
    console.error(
      "usage: npm run vendor -- <target dir>   (for example ../atrium/apps/api/vendor/ward)",
    );
    process.exit(2);
  }
  const targetDir = resolve(process.env.INIT_CWD ?? process.cwd(), target);
  try {
    const written = await vendor(targetDir);
    for (const file of written) console.log(`wrote ${file}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
