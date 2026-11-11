import preset from "./vendor/house-style/knip.json" with { type: "json" };

// knip has no `extends`, so this spreads the house preset and adds what knip can't find on its own.
export default {
  ...preset,
  ignore: [
    ...preset.ignore,
    // Unused for now (2026-11-11): the token layer's barrel, which no caller imports; each reaches into
    // the files instead. When the server's layout is settled, it is either used or deleted, and this goes.
    "api/src/tokens/index.ts",
  ],
  // docs/ is a Docusaurus package with its own ranges and build, outside the harness.
  ignoreWorkspaces: ["docs"],
  workspaces: {
    // The repo's scripts and the local seed, all run by hand.
    ".": { entry: ["scripts/*.{js,mjs,ts}", "infrastructure/local/*.mjs"] },
    // The library's two bundles, as scripts/build.mjs names them.
    "shared-library": { entry: ["src/index.ts", "src/react/index.ts"] },
  },
};
