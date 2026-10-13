/**
 * Build the two bundles and their two declaration files into `dist/`.
 *
 * - `ward-auth.js` / `ward-auth.d.ts`             from `src/index.ts` (server)
 * - `ward-auth-react.js` / `ward-auth-react.d.ts` from `src/react/index.ts` (hooks)
 *
 * **Rollup, with TypeScript's own transpiler, for the JavaScript.** One ES
 * module per entry, third-party code bundled in (node-resolve), Fastify, React
 * and `node:` built-ins left as imports. **Not minified, and the comments
 * kept**: this is security code an app owner must be able to read, step
 * through and diff between versions, and the comments are where the reasons
 * live — the dummy hash, the forwarded-address key, the cookie attributes.
 * esbuild was the first choice and was dropped for exactly this: it strips
 * every comment it does not consider a licence. **No source maps**, which
 * would carry build paths.
 *
 * **rollup-plugin-dts for the types**, because a vendored copy holds one
 * `.d.ts` per bundle and `tsc` emits one per source file.
 *
 * Run with `npm run build --workspace=shared-library`; `vendor.mjs` calls
 * `build()` directly.
 */

import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import ts from "typescript";

export const LIBRARY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(LIBRARY_ROOT, "dist");

/** Never bundled: the app brings its own. */
const PEERS = ["fastify", "react", "react/jsx-runtime"];

/** Peers and Node built-ins stay imports; everything else is bundled in. */
function isExternal(id) {
  return PEERS.includes(id) || id.startsWith("node:");
}

const ENTRIES = [
  { entry: "src/index.ts", out: "ward-auth" },
  { entry: "src/react/index.ts", out: "ward-auth-react" },
];

export async function readVersion() {
  const manifest = JSON.parse(await readFile(join(LIBRARY_ROOT, "package.json"), "utf8"));
  return manifest.version;
}

/**
 * Our own `.ts` sources: resolve the `./x.js` specifiers NodeNext requires to
 * the `.ts` file beside them, and strip the types with `transpileModule`,
 * which — unlike esbuild — keeps every comment.
 */
function typescriptSources() {
  return {
    name: "ward-typescript",
    resolveId(source, importer) {
      if (importer === undefined || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
      return existsSync(candidate) ? candidate : null;
    },
    transform(code, id) {
      if (!id.endsWith(".ts") || id.endsWith(".d.ts")) return null;
      const output = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          removeComments: false,
          verbatimModuleSyntax: false,
          isolatedModules: true,
          sourceMap: false,
        },
      });
      return { code: output.outputText, map: null };
    },
  };
}

/** Build everything into `dist/`. Returns the absolute paths of the four files. */
export async function build() {
  const version = await readVersion();
  await rm(DIST, { recursive: true, force: true });

  const banner =
    `// ward-auth ${version} — built from https://github.com/gandolh/ward-auth (shared-library/).\n` +
    `// MIT licensed; see LICENSE beside this file. Do not edit a vendored copy: copy a newer build in.`;

  const files = [];
  for (const { entry, out } of ENTRIES) {
    const input = join(LIBRARY_ROOT, entry);

    const code = await rollup({
      input,
      external: isExternal,
      plugins: [typescriptSources(), nodeResolve({ preferBuiltins: true })],
      onwarn(warning, warn) {
        // A warning is a build problem in a security bundle; make it loud.
        warn(warning);
        process.exitCode = 1;
      },
    });
    const outfile = join(DIST, `${out}.js`);
    await code.write({ file: outfile, format: "es", banner, sourcemap: false });
    await code.close();

    const types = await rollup({
      input,
      external: isExternal,
      plugins: [dts({ tsconfig: join(LIBRARY_ROOT, "tsconfig.json") })],
    });
    const declaration = join(DIST, `${out}.d.ts`);
    await types.write({ file: declaration, format: "es", banner });
    await types.close();

    files.push(outfile, declaration);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await build();
  for (const file of files) console.log(`built ${file.slice(LIBRARY_ROOT.length + 1)}`);
}
