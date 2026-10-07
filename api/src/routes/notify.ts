import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { MailTransport } from "../config.js";

import { readAppKeyHeader, resolveAppKey, type AuthenticatedApp } from "../auth/app-key.js";
import { getApp, type AppRow } from "../db/apps.js";
import { recordAudit } from "../db/audit-log.js";
import { getDb } from "../db/connection.js";
import { listRolesInApp } from "../db/grants.js";
import { findUserBySubject } from "../db/users.js";
import {
  appNotificationMail,
  NOTIFY_MAIL_SUBJECT_MAX,
  NOTIFY_TEXT_MAX,
} from "../mail/templates.js";
import { sendMail } from "../mail/transport.js";

/**
 * `POST /notify`: an app asks Ward to mail one of its own users.
 *
 * Apps key people on the opaque subject and hold no addresses. Ward holds the
 * verified address and sends the mail itself, so the address never leaves
 * Ward. The other option, letting an app key read verified addresses, was
 * rejected (`corpus/wiki/decisions-app-keys.md`): six copies of an address are
 * six places to leak it from, and an app that only needs to send a mail does
 * not need to know where it goes.
 *
 * The path is Fastify-side. Caddy serves Ward under `handle_path /ward-api/*`,
 * so a caller posts to `/ward-api/notify`.
 *
 * ## The contract
 *
 * - `x-ward-app-key` is checked first, in `onRequest`, before the body is even
 *   parsed. A bad key is `401 {"error":"invalid_app_key"}`, the same answer
 *   `/introspect` gives, for the same reason: a misconfigured app must fail
 *   loudly.
 * - The body is `{ subject, mailSubject, text }`, plain text.
 * - Success is `200 {"sent":true}`.
 * - Every refusal is `200 {"sent":false}`, byte for byte: no such account, a
 *   disabled account, no verified address, no grant for the calling app, a
 *   malformed body, or the app's rate limit. An app must not be able to tell
 *   these apart, for the reason `/introspect` has one inactive answer: a
 *   diagnosis is an oracle. Without this an app could ask whether any subject
 *   in the estate has a verified address, or holds a grant somewhere else.
 *   The reason goes to the audit log and the server log, for an operator.
 * - A mail transport failure is `503 {"error":"mail_unavailable"}`. That is
 *   Ward being broken, not a refusal, and the app should retry later.
 *   `@ward/client` raises `WardUnavailableError` for it, as for any non-200.
 *   It does not leak more than success does: it is only reachable on the path
 *   that would have sent.
 *
 * ## An app can mail its own users and nobody else
 *
 * Ward sends only when the account exists, is not disabled, has a verified
 * address, and holds at least one grant for the calling app. The app is the
 * one the key belongs to, never one named in the body. Holding a Ward account
 * confers nothing; an app with no grant over a person cannot reach them.
 *
 * ## The frame is Ward's
 *
 * The app supplies a subject line and a body. Ward sets the From name and the
 * subject prefix to the app's display name and appends a footer naming the
 * app and saying why the person gets the mail (`mail/templates.ts`). The body
 * schema is strict, so a call that tries to set `from`, `replyTo` or
 * `headers` is refused rather than sent without them.
 *
 * ## Every call is audited, under the app's name
 *
 * One `audit_log` row per keyed call: `notify.sent`, `notify.refused` with the
 * reason, or `notify.failed`. The actor is `system` with the label
 * `app:<slug>`: the table's actor kinds are a CHECK, Ward is the one sending,
 * and the label names the app it sent for. A new `app` actor kind would need
 * a table rebuild for a distinction the label already carries. The row holds
 * the subject as its target and never the mail's subject line or text, because
 * the audit log is never pruned and what an app writes to a person is not
 * Ward's to keep.
 *
 * A call with a bad key is not audited. It has no app to name, and an
 * anonymous caller must not be able to write to the audit log.
 *
 * ## The rate limit
 *
 * `NOTIFY_LIMIT` keyed calls per app per rolling `NOTIFY_WINDOW_MS`, counted
 * in process. See the constant for the number and the reasoning.
 */

/**
 * At most 2,000 calls per app in any rolling 24 hours.
 *
 * Sized from public-resource-map, the first caller. prm calls once per
 * notification row, from two sweeps: right after an admin accepts a batch of
 * new events (one row per follower of each place that got events; an accept
 * takes at most 500 events), and at 09:00 Europe/Bucharest (one row per
 * person per favorited event happening tomorrow). Both can land in the same
 * hour, and both are daily in shape. So the window is a day: an hourly cap
 * would need about the same number to cover the peak hour, and would then let
 * a loop send 24 times as much in a day.
 *
 * A heavy day at a few hundred people is under 1,000 calls. 2,000 doubles
 * that. A runaway loop, such as a crash-looping process whose startup sweep
 * never marks its rows, stops after 2,000 calls in a day. That matters beyond
 * the app: every app's notifications and every verification mail leave from
 * the same address, and a spam burst from one app hurts delivery for all of
 * them.
 *
 * Counted per process, in memory. A restart clears it, which is also the
 * operator's reset. Every keyed call counts, refused or sent, because a loop
 * over ineligible subjects still costs reads and audit rows. A call refused by
 * the limit does not count, so the budget comes back as the window rolls.
 */
export const NOTIFY_LIMIT = 2_000;
export const NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The route's body limit. 20,000 characters of text is at most about 80 KB of
 * UTF-8, and JSON escaping can grow that; 256 KiB covers any valid body. A
 * larger one is Fastify's own `413`, after the key check.
 */
export const NOTIFY_BODY_LIMIT = 256 * 1024;

/** A sliding-window counter of admitted calls, per app. */
export interface NotifyLimiter {
  /** Count a call for `appSlug` and say whether it is admitted. */
  take(appSlug: string, now?: number): boolean;
}

/**
 * A sliding window rather than a fixed one, because a fixed daily window lets
 * twice the limit through across its boundary. The timestamps of admitted calls
 * are kept per app, oldest first; at most `limit` per app, so the memory is
 * bounded by the number of apps times the limit.
 */
export function createNotifyLimiter(
  limit: number = NOTIFY_LIMIT,
  windowMs: number = NOTIFY_WINDOW_MS,
): NotifyLimiter {
  const admitted = new Map<string, number[]>();

  return {
    take(appSlug: string, now: number = Date.now()): boolean {
      let stamps = admitted.get(appSlug);
      if (stamps === undefined) {
        stamps = [];
        admitted.set(appSlug, stamps);
      }

      const cutoff = now - windowMs;
      let expired = 0;
      while (expired < stamps.length && stamps[expired]! <= cutoff) expired += 1;
      if (expired > 0) stamps.splice(0, expired);

      if (stamps.length >= limit) return false;
      stamps.push(now);
      return true;
    },
  };
}

export interface NotifyRoutesOptions {
  /** For tests. Production resolves the process-wide handle lazily. */
  db?: Database.Database;
  /** For tests. Production uses `MAIL` from `config.ts`. */
  transport?: MailTransport;
  /** For tests that need a small limit. Production builds one with the defaults. */
  limiter?: NotifyLimiter;
}

/** Any C0 or C1 control character. A subject line is one header line. */
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/**
 * The body. Strict: an unknown key is a refusal, so `from`, `replyTo` or
 * `headers` cannot be sent and silently ignored.
 *
 * `subject` is bounded like the console's `:subject` parameter rather than
 * pinned to 32 hex characters, so an account created with a supplied subject
 * is still reachable. Existence is the real check.
 */
const notifyBody = z.strictObject({
  subject: z.string().min(1).max(64),
  mailSubject: z
    .string()
    .trim()
    .min(1)
    .max(NOTIFY_MAIL_SUBJECT_MAX)
    .refine((value) => !ANY_CONTROL.test(value)),
  text: z
    .string()
    .max(NOTIFY_TEXT_MAX)
    .refine((value) => value.trim().length > 0)
    .refine((value) => !CONTROL_EXCEPT_WHITESPACE.test(value)),
});

/** Why a call was refused. For the audit log and the server log only. */
export type NotifyRefusal =
  | "rate_limited"
  | "invalid_body"
  | "unknown_subject"
  | "disabled"
  | "no_verified_email"
  | "no_grant"
  | "unknown_app";

type Recipient = { ok: true; email: string; app: AppRow } | { ok: false; reason: NotifyRefusal };

/**
 * Whether Ward may mail this subject for this app, and where to.
 *
 * Every check reads Ward's own tables. The app is the key's app, never one the
 * caller names.
 */
function findRecipient(db: Database.Database, subject: string, appSlug: string): Recipient {
  const user = findUserBySubject(db, subject);
  if (user === undefined) return { ok: false, reason: "unknown_subject" };
  if (user.disabled_at !== null) return { ok: false, reason: "disabled" };
  if (user.email === null || user.email_verified !== 1) {
    return { ok: false, reason: "no_verified_email" };
  }
  if (listRolesInApp(db, subject, appSlug).length === 0) return { ok: false, reason: "no_grant" };

  // Always present: a key belongs to an app and is deleted with it.
  const app = getApp(db, appSlug);
  if (app === undefined) return { ok: false, reason: "unknown_app" };

  return { ok: true, email: user.email, app };
}

/**
 * The subject a call names, for the audit row's target, even when the body as
 * a whole is refused. Only a string within the schema's bound qualifies.
 */
function claimedSubject(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as { subject?: unknown }).subject;
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
}

/** The serialisation schema. Also a filter: nothing else can reach the app. */
const NOTIFY_ROUTE_SCHEMA = {
  200: {
    type: "object",
    properties: { sent: { type: "boolean" } },
    required: ["sent"],
    additionalProperties: false,
  },
  401: {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
    additionalProperties: false,
  },
  503: {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
    additionalProperties: false,
  },
} as const;

export async function notifyRoutes(
  app: FastifyInstance,
  options: NotifyRoutesOptions = {},
): Promise<void> {
  const database = async (): Promise<Database.Database> => options.db ?? (await getDb());
  const transport = async (): Promise<MailTransport> =>
    options.transport ?? (await import("../config.js")).MAIL;

  // One limiter per registration, so one per process in production.
  const limiter = options.limiter ?? createNotifyLimiter();

  // The app each request authenticated as, handed from the hook to the handler.
  const callers = new WeakMap<FastifyRequest, AuthenticatedApp>();

  app.post(
    "/notify",
    {
      bodyLimit: NOTIFY_BODY_LIMIT,
      schema: { response: NOTIFY_ROUTE_SCHEMA },
      /**
       * The app key, before anything else, including body parsing. Nothing an
       * anonymous caller sends is parsed, counted or written.
       */
      onRequest: async (request, reply) => {
        reply.header("cache-control", "no-store");

        const caller = resolveAppKey(await database(), readAppKeyHeader(request));
        if (!caller.ok) {
          request.log.warn(
            { reason: caller.reason },
            "notify: refusing a request with no usable app key",
          );
          return reply.code(401).send({ error: "invalid_app_key" });
        }

        callers.set(request, caller.app);
      },
    },
    async (request, reply) => {
      const caller = callers.get(request);
      if (caller === undefined) {
        // Unreachable: the hook either set it or answered. A throw, not a
        // `sent: false`, so a wiring mistake is a loud 500.
        throw new Error("notify: handler reached without an authenticated app");
      }

      const db = await database();
      const slug = caller.appSlug;
      const target = claimedSubject(request.body);

      const audit = (action: string, detail: Record<string, unknown>): void => {
        recordAudit(db, {
          actorKind: "system",
          actorLabel: `app:${slug}`,
          action,
          targetKind: target === undefined ? null : "user",
          targetId: target ?? null,
          detail: { app: slug, keyId: caller.keyId, ...detail },
        });
      };

      const refuse = (reason: NotifyRefusal): { sent: false } => {
        audit("notify.refused", { reason });
        // An integration bug or a runaway loop is worth an operator's
        // attention. An ineligible person is ordinary traffic.
        const level = reason === "rate_limited" || reason === "invalid_body" ? "warn" : "debug";
        request.log[level]({ app: slug, reason }, "notify: refused");
        return { sent: false };
      };

      if (!limiter.take(slug)) return refuse("rate_limited");

      const parsed = notifyBody.safeParse(request.body);
      // zod's issues are not logged: they would echo the submitted text.
      if (!parsed.success) return refuse("invalid_body");

      const { subject, mailSubject, text } = parsed.data;
      const recipient = findRecipient(db, subject, slug);
      if (!recipient.ok) return refuse(recipient.reason);

      const mail = appNotificationMail({
        to: recipient.email,
        appName: recipient.app.name,
        mailSubject,
        text,
      });

      const via = await transport();
      let messageId: string;
      try {
        messageId = (await sendMail(mail, via)).messageId;
      } catch (error) {
        /**
         * Ward could not send. Not a refusal: the person is eligible and the
         * app should try again later, so this is a 503 the client turns into
         * `WardUnavailableError`. The audit row carries no error text; an SMTP
         * error can carry a hostname and the recipient's address.
         */
        request.log.error({ err: error, app: slug }, "notify: the mail could not be sent");
        audit("notify.failed", { transport: via.kind });
        return reply.code(503).send({ error: "mail_unavailable" });
      }

      audit("notify.sent", { transport: via.kind, messageId });
      return { sent: true };
    },
  );
}
