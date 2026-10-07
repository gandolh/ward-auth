import { WardConfigurationError, WardUnavailableError } from "./errors.js";

/**
 * Asking Ward to mail one of this app's users: `POST /notify`.
 *
 * The app names a subject and supplies a subject line and plain text. Ward
 * looks up the verified address, wraps the text in a frame naming the app, and
 * sends it. The address never reaches the app.
 *
 * Ward answers `{ sent: true }` or `{ sent: false }`. A refusal does not say
 * why: no such account, disabled, no verified address, no grant for this app,
 * a malformed request, or this app's rate limit all read the same. Treat a
 * refusal as final for that message. The reason is in Ward's audit log.
 *
 * Anything else throws:
 *
 * - `WardConfigurationError` on a `401`: Ward refused this app's key. Retrying
 *   will not help; fix `WARD_APP_KEY`.
 * - `WardUnavailableError` on a network error, a timeout, any other status
 *   (including Ward's `503` when its mail transport fails), or a body that is
 *   not `{ sent: boolean }`. The message was not confirmed sent; retry later.
 *
 * A timeout is ambiguous: Ward may have sent the mail after this side gave up,
 * so a retry can deliver it twice. For notifications that is the right side
 * to fail on.
 */

/** What an app asks Ward to send. */
export interface NotificationInput {
  /** The recipient's Ward subject. */
  subject: string;
  /** One line of plain text, at most 200 characters. Ward prefixes the app's name. */
  mailSubject: string;
  /** Plain text, at most 20,000 characters. Ward appends a footer naming the app. */
  text: string;
}

export interface NotificationResult {
  sent: boolean;
}

export interface NotifierOptions {
  /** Ward's `POST /notify`, fully qualified: `https://gandolh.ro/ward-api/notify`. */
  notifyUrl: URL;
  /** This app's key, sent as `x-ward-app-key`. A server-side secret. */
  appKey: string;
  /** Injectable fetch. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Request timeout in ms. Defaults to 15000: Ward answers after its mail
   * transport accepts the message, which is slower than an introspection.
   */
  timeoutMs?: number;
}

export const DEFAULT_NOTIFY_TIMEOUT_MS = 15_000;

/** A `sendNotification` function bound to one Ward and one app key. No cache, no retry. */
export function createNotifier(
  options: NotifierOptions,
): (input: NotificationInput) => Promise<NotificationResult> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_NOTIFY_TIMEOUT_MS;

  return async function sendNotification(input: NotificationInput): Promise<NotificationResult> {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      try {
        response = await fetchImpl(options.notifyUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ward-app-key": options.appKey,
          },
          // Exactly the three fields. Ward refuses any other key.
          body: JSON.stringify({
            subject: input.subject,
            mailSubject: input.mailSubject,
            text: input.text,
          }),
          signal: controller.signal,
        });
      } catch (cause) {
        throw new WardUnavailableError("notify request failed", { cause });
      }

      if (response.status === 401) {
        throw new WardConfigurationError(
          "Ward rejected this app's key (401). Check WARD_APP_KEY: it is absent, wrong, or has been revoked in Ward's console.",
        );
      }

      if (response.status !== 200) {
        throw new WardUnavailableError(`notify returned unexpected status ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new WardUnavailableError("notify response was not valid JSON", { cause });
      }

      const sent = (body as { sent?: unknown } | null)?.sent;
      if (typeof sent !== "boolean") {
        throw new WardUnavailableError("notify response did not match Ward's contract");
      }

      return { sent };
    } finally {
      // Cleared after the body is read, so a body that stalls also times out.
      clearTimeout(timer);
    }
  };
}
