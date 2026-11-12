import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "@fastify/type-provider-zod";
import type { FastifyError, FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * The one error handler, set on the root so every route answers through it.
 * `fastify-plugin` lifts it out of its own scope; registered anywhere but
 * first, a plugin registered before it would keep Fastify's default handler.
 *
 * **Fastify's default is a leak.** With no handler Fastify's reply puts
 * `err.message` in the body, and the reproduction was as bad as that sounds: a
 * missing signing key plus *correct* credentials answered `500` with the
 * absolute on-disk path of the estate's signing key and the shape of the
 * deploy layout, from the one route the whole internet can reach
 * unauthenticated. A `SqliteError` would hand out a column name the same way.
 *
 * Four cases, and Ward's own bodies throughout (no envelope is imposed):
 *
 * - **A request that fails its route's schema** answers `400
 *   { "error": "invalid_request" }`, the body every hand-parsed route sent
 *   before the schemas existed, and nothing else: zod's issue list echoes the
 *   submitted values, and on Ward one of them can be a password.
 * - **Fastify's own client errors** pass through as `{ statusCode, error,
 *   message }`: a `415` on an unsupported content type, a `400` on an
 *   unparseable body, a `413`. Those messages are about the request the caller
 *   sent, not about this server, and the login UI renders some of them.
 * - **A reply its route's response schema rejects** is a bug here, never the
 *   caller's: `500 { "error": "internal" }`. The log names the route, not the
 *   reply, because a reply on Ward can carry a token or a session.
 * - **Anything else**, or a throw claiming a 5xx, is `500 { "error":
 *   "internal" }`, with the real error logged at `error` first, bound to the
 *   request, so nothing is lost to the operator.
 *
 * Deliberate client errors from the routes never reach this handler: each
 * sends its own `{ error: "<code>" }` with `reply.code(...).send(...)`.
 */
async function errorHandler(app: FastifyInstance): Promise<void> {
  // The `<FastifyError>` is load-bearing: Fastify types the error parameter as
  // `unknown` by default, and `statusCode` is the property that tells a
  // deliberate client error from a genuine fault.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ statusCode: 400, context: error.validationContext }, "request failed its schema");
      return reply.code(400).send({ error: "invalid_request" });
    }

    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: { name: error.name, code: error.code }, method: request.method, url: request.routeOptions.url },
        "a reply failed its response schema",
      );
      return reply.code(500).send({ error: "internal" });
    }

    const status = typeof error.statusCode === "number" ? error.statusCode : 500;

    if (status >= 400 && status < 500) {
      request.log.info({ err: error, statusCode: status }, "request rejected");
      return reply.code(status).send({
        statusCode: status,
        error: error.name,
        message: error.message,
      });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal" });
  });
}

export const errorsPlugin = fp(errorHandler, { name: "ward-errors" });
