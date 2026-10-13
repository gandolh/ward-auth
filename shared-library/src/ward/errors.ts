/**
 * The errors the Ward half throws, shaped like `client/`'s so an app moving
 * off that package keeps its `instanceof` checks.
 */

/**
 * Ward could not be reached, or answered outside its documented contract: a
 * network error, a timeout, an unexpected status, a body that does not parse.
 *
 * **Not** the same as "this session is not active". Every caller fails closed
 * on it: a Ward-originated session is refused while Ward cannot answer, and
 * the person is told to sign in with their local password instead
 * (decisions-oidc.md, "Failing closed still holds"). `statusCode` 503, so a
 * Fastify error handler that does nothing special still answers sensibly.
 */
export class WardUnavailableError extends Error {
  /** Widened so `WardConfigurationError` can name itself. */
  override readonly name: string = "WardUnavailableError";
  readonly statusCode: number = 503;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Ward refused this app's client credential: a `401 invalid_client`.
 *
 * A subclass of `WardUnavailableError`, so every call site that fails closed
 * on that keeps doing so. What it adds is the diagnosis: everything else that
 * goes wrong talking to Ward is transient and about Ward, while this is
 * permanent and about **this app's configuration** — `WARD_OIDC_CLIENT_ID` or
 * `WARD_OIDC_CLIENT_KEY` is wrong, or the public half is not registered in
 * Ward's console. Retrying will not help.
 */
export class WardConfigurationError extends WardUnavailableError {
  override readonly name = "WardConfigurationError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Why a "Sign in with Ward" round trip did not produce a signed-in user. The
 * `code` is what the callback puts in `?ward_error=` and what the React hooks
 * expose; the app writes the message.
 */
export class WardSignInError extends Error {
  override readonly name = "WardSignInError";

  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
