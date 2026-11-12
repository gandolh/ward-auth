import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

/**
 * `GET /health` — the scaffold's only route. The container's health check and
 * any uptime check hit this, so it stays cheap and dependency-free: no
 * database touch, no auth, nothing that can go slow or fail for a reason
 * unrelated to "is the process up." Other routes are separate plugins
 * registered by `buildApp` (see `api/src/app.ts`); this file does not grow to
 * cover them.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/health", { schema: { response: { 200: z.object({ status: z.literal("ok") }) } } }, async () => {
    return { status: "ok" as const };
  });
};
