import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { requireConsoleSession } from "../../auth/console-guard.js";
import { errorReply } from "../../lib/replies.js";
import { countAudit, listAudit, type AuditLogRow, type AuditQuery } from "../../db/audit-log.js";
import { databaseResolver, type AdminRoutesOptions } from "./support.js";

/**
 * `GET /console/audit` — read the audit trail.
 *
 * ## Why this route is not optional
 *
 * The break-glass superuser lives in `.env`, has no account row, and **cannot
 * be revoked or rotated without a redeploy**
 * (`corpus/wiki/decisions-admin.md`). That trade is accepted because it is the
 * only credential that still works when the database is empty or the last admin
 * has been removed — and the price named in the same decision is that this log
 * is *the only observability the credential has*. Every console mutation has
 * been writing rows since 2026-09-04; until this route existed there was no way
 * to read them, so the requirement was met in the schema and unmet in practice.
 *
 * ## The filter that could not work, and now can
 *
 * `AuditQuery` originally offered exactly one actor filter, `actorSubject` —
 * and a CHECK ties `actor_subject IS NOT NULL` to `actor_kind = 'account'`, so
 * that column is **null for every row the console itself writes**. "Filterable
 * by actor" was therefore unsatisfiable for the one actor whose trail is the
 * reason the table exists. `db/audit-log.ts` now takes `actorKind` and
 * `actorLabel` as well; `actorKind=superuser` is the query an operator actually
 * needs, and it is the one this route was built to serve.
 *
 * ## Read-only, and no audit row of its own
 *
 * Reading the log does not append to it. An operator paging through a screen
 * would otherwise write a row per page view and bury the rows they came to
 * find under their own scrolling — the same write-amplification reasoning
 * `/session-status` and `/login`'s unknown-username branch both record.
 *
 * ## Pagination is keyset, not offset
 *
 * The log grows at the **head**, so an offset-paged second page shifts under
 * the reader every time anything happens. `beforeId` is the cursor
 * (`db/audit-log.ts` explains the choice), and `nextBeforeId` in the response
 * is the value to send for the following page — `null` when the page just
 * returned was the last one.
 */

/**
 * The filters, all optional, all bound as values by `listAudit`.
 *
 * `actorKind` and `targetKind` are `z.enum` rather than free strings so a typo
 * (`?actorKind=superusers`) is a `400` naming the mistake rather than a silently
 * empty page that reads as "nothing ever happened on this surface" — the single
 * most misleading answer this screen can give.
 *
 * `limit` defaults to 200, which is what the console asks for, and is
 * capped at 500. `beforeId` starts at 1 because `audit_log.id` is a rowid
 * alias.
 */
const auditQuery = z.object({
  actorKind: z.enum(["superuser", "account", "system"]).optional(),
  actorSubject: z.string().min(1).max(64).optional(),
  actorLabel: z.string().min(1).max(256).optional(),
  targetKind: z.enum(["user", "app", "grant", "session", "token"]).optional(),
  targetId: z.string().min(1).max(1024).optional(),
  action: z.string().min(1).max(128).optional(),
  beforeId: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * One row as the console renders it: camel-cased, with `detail` parsed.
 *
 * `detail` is `unknown` rather than a record because the column is free-form
 * JSON written by whatever event produced the row, and typing it as an object
 * would be a promise this module cannot keep for rows written by a future
 * action.
 */
export interface AuditRowView {
  id: number;
  at: string;
  actorKind: AuditLogRow["actor_kind"];
  actorSubject: string | null;
  actorLabel: string;
  action: string;
  targetKind: AuditLogRow["target_kind"];
  targetId: string | null;
  detail: unknown;
}

/**
 * `detail` as a value, or the raw string when it is not JSON.
 *
 * `audit_log.detail` has no CHECK and `recordAudit` is not the only thing that
 * could ever write it — a hand-inserted row or a cutover script could put
 * anything there. Returning the raw string rather than throwing keeps one bad
 * row from taking the whole page down, which is the same call
 * `parseGrantTargetId` makes for the same reason.
 */
function parseDetail(detail: string | null): unknown {
  if (detail === null) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

function auditView(row: AuditLogRow): AuditRowView {
  return {
    id: row.id,
    at: row.at,
    actorKind: row.actor_kind,
    actorSubject: row.actor_subject,
    actorLabel: row.actor_label,
    action: row.action,
    targetKind: row.target_kind,
    targetId: row.target_id,
    detail: parseDetail(row.detail),
  };
}

/**
 * The response schemas: each status the handlers send themselves, keys in the
 * order they build them. No 401: `requireConsoleSession` sends it, and a
 * declared status would encode the guard's reply too.
 */
const auditRowSchema = z.object({
  id: z.number(),
  at: z.string(),
  actorKind: z.string(),
  actorSubject: z.string().nullable(),
  actorLabel: z.string(),
  action: z.string(),
  targetKind: z.string().nullable(),
  targetId: z.string().nullable(),
  // Each action's own fields, as written: passed through whole.
  detail: z.unknown(),
});
const listSchema = {
  200: z.object({ entries: z.array(auditRowSchema), total: z.number(), nextBeforeId: z.number().nullable() }),
  400: errorReply,
};

export const adminAuditRoutes: FastifyPluginAsyncZod<AdminRoutesOptions> = async (app, options) => {
  const database = databaseResolver(options);

  // The gate, for the whole plugin scope — see the note in `apps.ts`.
  app.addHook("preValidation", requireConsoleSession);

  app.get("/console/audit", { schema: { querystring: auditQuery, response: listSchema } }, async (request, reply) => {
    reply.header("cache-control", "no-store");

    const { limit, ...filters } = request.query;
    const query: AuditQuery = { ...filters, limit };

    const db = await database();
    const rows = listAudit(db, query);
    const oldest = rows.at(-1);

    /**
     * **`total` is the size of the whole log, not of the filtered set.**
     *
     * That is what answers the operator's question — "am I looking at
     * everything?" — and it is what the console's table renders: "42 shown of 1207
     * in the log". A filtered count would make the two numbers agree whenever a
     * filter was applied and so say nothing at all, and it would cost a second
     * scan of the same predicate on a screen that is already showing every row
     * it matched.
     */
    return reply.code(200).send({
      entries: rows.map(auditView),
      total: countAudit(db),
      /**
       * The cursor for the next page, or `null` when this page was short of
       * `limit` and is therefore the last one. Derived from the oldest row
       * returned, because the list is newest-first.
       */
      nextBeforeId: oldest === undefined || rows.length < limit ? null : oldest.id,
    });
  });
};
