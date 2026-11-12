import { serializerCompiler, validatorCompiler, type FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { errorsPlugin } from "./errors.js";

/**
 * The error plugin on a bare Fastify with the zod compilers, and routes that
 * fail each way. `app.test.ts` drives the same handler through the real
 * `buildApp()`.
 */

const SECRET = "a-submitted-password-0123";

const routes: FastifyPluginAsyncZod = async (scope) => {
  scope.post(
    "/validated",
    { schema: { body: z.object({ username: z.string(), password: z.string().min(40) }) } },
    async () => ({ ok: true }),
  );
  scope.get(
    "/bad-reply",
    { schema: { response: { 200: z.object({ token: z.number() }) } } },
    async () => ({ token: SECRET }) as unknown as { token: number },
  );
};

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorsPlugin);
  await app.register(routes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("the error plugin", () => {
  it("answers a schema failure with Ward's terse 400 and no issue list", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/validated",
      payload: { username: "a", password: SECRET },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('{"error":"invalid_request"}');
  });

  it("answers a reply its response schema rejects with the fixed 500, never the reply", async () => {
    const response = await app.inject({ method: "GET", url: "/bad-reply" });
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('{"error":"internal"}');
  });

  it("passes Fastify's own client errors through with their status", async () => {
    const broken = await app.inject({
      method: "POST",
      url: "/validated",
      payload: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(broken.statusCode).toBe(400);
    expect(Object.keys(broken.json<object>())).toEqual(["statusCode", "error", "message"]);

    const unsupported = await app.inject({
      method: "POST",
      url: "/validated",
      payload: "<a/>",
      headers: { "content-type": "application/xml" },
    });
    expect(unsupported.statusCode).toBe(415);
  });
});
