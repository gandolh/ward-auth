import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { z } from "zod";

import { errorsPlugin } from "../plugins/errors.js";

/**
 * A bare Fastify for a test that registers one feature's routes on its own,
 * set up as `buildApp()` sets up the real one: the zod compilers and the error
 * plugin. Without the compilers a route's zod schema doesn't compile, and
 * without the plugin a request that fails its schema gets Fastify's default 400
 * instead of Ward's.
 */
export async function testFastify(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorsPlugin);
  return app;
}

/**
 * A body encoded through a response schema, as Fastify sends it once the route
 * declares the schema for that status. A filter test pushes an over-full object
 * through it and checks what comes out.
 */
export function encodeReply(schema: z.ZodType, body: unknown, status = 200): string {
  return serializerCompiler({ schema, method: "GET", url: "/test", httpStatus: String(status) })(body);
}
