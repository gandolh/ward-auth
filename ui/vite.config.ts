import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Ward's SPA, served at the root of its own host, `ward.<domain>`, since
 * 2026-10-22 (brief 32). It was at `/ward` on the estate's shared origin.
 *
 * `base` is not cosmetic. Every asset URL Vite emits carries it, and a build
 * whose base disagrees with where Caddy serves it loads a page whose JavaScript
 * 404s — the failure that looks like "the login page is blank". The deploy
 * checks that `index.html` loads from `/assets/`.
 */
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    /**
     * `/ward-api` is proxied in development so the browser sees one origin,
     * exactly as it will in production behind Caddy. Without this the cookies
     * would be cross-site in dev and same-site in prod — and `SameSite=Lax`
     * behaves differently across that line, so the bug would only ever appear
     * in the environment you cannot debug.
     */
    proxy: {
      "/ward-api": {
        target: "http://127.0.0.1:8791",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/ward-api/, ""),
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
