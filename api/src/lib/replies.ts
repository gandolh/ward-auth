import { z } from "zod";

/**
 * The response schema for a 4xx or 5xx a route sends itself: Ward's
 * `{ "error": "<code>" }`.
 *
 * A declared status encodes **every** reply on that status, the error
 * handler's included, so the same schema has to carry Fastify's own client
 * errors through unchanged: `{ statusCode, error, message }` for a body that
 * isn't JSON (a 400 the login page shows). The two optional fields, in that
 * order, keep both shapes byte for byte; a plain `{ error }` would strip the
 * other two from Fastify's.
 */
export const errorReply = z.object({
  statusCode: z.number().optional(),
  error: z.string(),
  message: z.string().optional(),
});

/** A 429 from the lockout: the code and the seconds until the next attempt, also in `Retry-After`. */
export const lockedOutReply = z.object({ error: z.string(), retryAfterSeconds: z.number() });
