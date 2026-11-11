// The house dependency-cruiser preset, from the vendored house-style copy: no cycles, no unresolvable
// imports, a feature used through its index only, no Fastify in lib/.
module.exports = {
  extends: "./vendor/house-style/.dependency-cruiser.cjs",
  forbidden: [
    // A warning for now (2026-11-11): the library's Fastify plugin and its Ward routes import each other
    // (fastify/ward.ts takes the SessionValidator type from fastify/plugin.ts). When that type moves to a
    // module of its own with the library's structure, this goes and a cycle is an error again.
    { name: "no-circular", severity: "warn" },
  ],
};
