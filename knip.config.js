import preset from "./vendor/house-style/knip.json" with { type: "json" };

// knip has no `extends`, so this spreads the house preset and adds what knip can't find on its own.
export default {
  ...preset,
  // docs/ is a Docusaurus package with its own ranges and build, outside the harness.
  ignoreWorkspaces: ["docs"],
  workspaces: {
    // The repo's scripts and the local seed, all run by hand.
    ".": { entry: ["scripts/*.{js,mjs,ts}", "infrastructure/local/*.mjs"] },
    // The library's two bundles, as scripts/build.mjs names them.
    "shared-library": { entry: ["src/index.ts", "src/react/index.ts"] },
  },
};
