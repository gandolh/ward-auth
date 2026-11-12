// The house dependency-cruiser preset, from the vendored house-style copy: no cycles, no unresolvable
// imports, a feature used through its index only, no Fastify in lib/.
module.exports = {
  extends: "./vendor/house-style/.dependency-cruiser.cjs",
  forbidden: [
    // A warning for now (2026-11-11): the library's Fastify plugin and its Ward routes import each other
    // (fastify/ward.ts takes the SessionValidator type from fastify/plugin.ts). When that type moves to a
    // module of its own with the library's structure, this goes and a cycle is an error again.
    { name: "no-circular", severity: "warn" },
    {
      name: "domain-not-to-features",
      severity: "error",
      comment:
        "The API's domain modules (auth, db, grants, mail, oidc, tokens) and its shared layers sit under the features: a feature imports them freely, and they never import a feature.",
      from: {
        path: "^api/src/((auth|db|grants|mail|oidc|tokens|lib|plugins|testing)/|(audit|config)\\.ts$)",
      },
      to: { path: "^api/src/features/" },
    },
    {
      name: "app-through-feature-index",
      severity: "error",
      comment: "app.ts registers each feature through its index.ts, as another feature would use it.",
      from: { path: "^api/src/app\\.ts$" },
      to: { path: "^api/src/features/[^/]+/", pathNot: "^api/src/features/[^/]+/index\\.ts$" },
    },
  ],
};
