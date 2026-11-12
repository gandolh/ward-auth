import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { recordConsoleAudit } from "../../audit.js";
import { requireConsoleSession } from "../../auth/console-guard.js";
import { errorReply } from "../../lib/replies.js";
import { hashPassword, PasswordPolicyError } from "../../auth/password.js";
import { listGrantsForSubject } from "../../db/grants.js";
import { listLiveTokensForSubject, revokeAllForSubject } from "../../db/refresh-tokens.js";
import {
  countUsers,
  createUser,
  deleteUser,
  findUserBySubject,
  listUsers,
  setDisabled,
  setPasswordHash,
  setUsername,
  type UserRow,
} from "../../db/users.js";
import {
  accountView,
  accountViewSchema,
  databaseResolver,
  grantView,
  grantViewSchema,
  isUniqueViolation,
  type AdminRoutesOptions,
} from "./support.js";

/**
 * Account management: `GET`, `POST /console/accounts`, `GET
 * /console/accounts/:subject`, `POST .../disable`, `.../enable`,
 * `.../password`, `.../username`, and `DELETE /console/accounts/:subject`.
 *
 * **This is how the owner account comes into existence.** Ward's superuser is a
 * break-glass credential in `.env` with no account row, no subject and no
 * grants; it can reach the console and nothing else, because access in this
 * estate *is* a grant and it holds none. Day-to-day administration of the apps
 * belongs to an ordinary account with explicit admin grants across them, created
 * here by the superuser at cutover (`corpus/wiki/decisions-admin.md`). Every
 * invited person arrives the same way.
 *
 * Those two identities are not interchangeable, and this file does not blur
 * them: creating an account never confers a grant, and the account it creates
 * has no more standing on this surface than any other. There is no way to
 * delegate console access, deliberately.
 *
 * ## No email on this path
 *
 * The create route does not accept one. Username is the canonical identifier, so
 * an address identifies nobody; it is collected and verified on **public
 * registration** only, where the strangers are. The cost is accepted
 * and recorded: an owner-issued account has **no recovery channel**, and a
 * forgotten password is fixed by the operator rotating it below.
 *
 * ## Disabling ends live sessions; it does not destroy the identity
 *
 * `users.disabled_at` alone would only block *future* logins — an access token
 * minted a minute earlier stays signed and valid for its full 15 minutes, and
 * the refresh token behind it would keep minting more for thirty days. So
 * disabling revokes the account's refresh families in the same transaction
 * (reason `admin`), which is what actually ends the session. `GET /session`
 * then reports `active: false`, and apps end theirs within 30 seconds through
 * `/session-status`.
 *
 * Grants and the subject survive: this is a door being locked, not an identity
 * being destroyed, so re-enabling restores exactly what was there. Re-enabling
 * does **not** bring the sessions back — a revoked refresh token stays revoked
 * and the person signs in again, which is the only safe direction.
 *
 * ## Deleting does destroy the identity
 *
 * `DELETE` removes the row, and the schema's cascades take its grants, refresh
 * tokens, verification tokens and OIDC authorizations with it. Nothing comes
 * back. The subject is retired, never re-minted, so no later account can
 * inherit an app's rows. The username is freed: a new account under it is a
 * new subject and a stranger to every app. The audit row survives, because
 * `audit_log` has no foreign keys for exactly this reason. Disable is the
 * reversible door; delete is for an account that should not exist.
 */

/** The `:subject` path parameter. Opaque, bounded; existence is the real check. */
const subjectParams = z.object({
  subject: z.string().min(1).max(64),
});

/**
 * A username.
 *
 * Trimmed, because a trailing space in a username is invisible and never
 * intentional — the same rule `routes/auth.ts` applies on the login path, and
 * the two must agree or an account is created that cannot be logged into.
 * Uniqueness, case folding and Unicode form are `db/users.ts`'s job
 * (`foldUsername`, NFKC then lower case), not this schema's.
 *
 * What *is* refused is anything that cannot be read back reliably: control
 * characters (`\p{C}` — the C0/C1 ranges plus format characters such as a
 * zero-width joiner) and any space-like character that is not a plain ASCII
 * space (`\p{Zs}` — a no-break space, an en quad, an ideographic space).
 * Doubled, leading and trailing spaces go too, so a name is a run of visible
 * characters joined by single spaces and nothing else.
 *
 * The reason is the console's own account list. It is where an operator decides
 * who to trust, and two accounts that render identically there — `cristian` and
 * `cristian ` with a no-break space — are a way to be granted the wrong person's
 * access by clicking the wrong row. `foldUsername` collapses case and Unicode
 * *form* (NFKC), which handles a full-width `ａlice`; it does not collapse
 * whitespace, so this is the half it does not cover.
 */
const username = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\p{C}\p{Zs}]+(?: [^\p{C}\p{Zs}]+)*$/u, {
    message: "username contains a control character or unusual whitespace",
  });

/**
 * A password, with **no length rule here on purpose**.
 *
 * `auth/password.ts` owns the policy and throws `PasswordPolicyError` with a
 * stable `code`; the routes surface that code. Duplicating the bounds in zod
 * would answer `invalid_request` for a short password instead of
 * `password_too_short`, which tells the operator nothing, and would put the real
 * rule in two places that can disagree.
 */
const password = z.string();

const createAccountBody = z.object({ username, password });
const passwordBody = z.object({ password });
const usernameBody = z.object({ username });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The response schemas: each status the handlers send themselves, keys in the
 * order they build them. No 401: `requireConsoleSession` sends it, and a
 * declared status would encode the guard's reply too.
 */
const listSchema = { 200: z.object({ accounts: z.array(accountViewSchema), total: z.number() }), 400: errorReply };
const detailSchema = {
  200: z.object({ account: accountViewSchema, grants: z.array(grantViewSchema), liveSessions: z.number() }),
  400: errorReply,
  404: errorReply,
};
const createSchema = { 201: z.object({ account: accountViewSchema }), 400: errorReply, 409: errorReply };
const disableSchema = {
  200: z.object({ account: accountViewSchema, sessionsRevoked: z.number() }),
  400: errorReply,
  404: errorReply,
};
const enableSchema = {
  200: z.object({ account: accountViewSchema, changed: z.boolean() }),
  400: errorReply,
  404: errorReply,
};
const renameSchema = { ...enableSchema, 409: errorReply };
const passwordSchema = {
  200: z.object({ subject: z.string(), sessionsRevoked: z.number() }),
  400: errorReply,
  404: errorReply,
};
const deleteSchema = {
  200: z.object({ deleted: z.string(), username: z.string(), grantsRevoked: z.number(), sessionsRevoked: z.number() }),
  400: errorReply,
  404: errorReply,
};

export const adminAccountsRoutes: FastifyPluginAsyncZod<AdminRoutesOptions> = async (app, options) => {
  const database = databaseResolver(options);

  // The gate, for the whole plugin scope — see the note in `apps.ts`.
  app.addHook("preValidation", requireConsoleSession);

  /** `GET /console/accounts` — the console's list, ordered the way a human scans it. */
  app.get("/console/accounts", { schema: { response: listSchema } }, async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    return reply.code(200).send({
      accounts: listUsers(db, query.data.limit, query.data.offset).map(accountView),
      total: countUsers(db),
    });
  });

  /**
   * `GET /console/accounts/:subject` — one account with everything it holds.
   *
   * `grants` is read straight from `db/grants.ts` rather than through
   * `grants/resolve.ts`: that module answers the session check on a hot path,
   * and this is an operator looking at a page. Borrowing
   * it here would couple the console to a shape chosen for the session check.
   *
   * `liveSessions` is the count that makes "disabling ends live sessions"
   * visible in the UI — and the number an operator checks before believing it.
   */
  app.get("/console/accounts/:subject", { schema: { response: detailSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const row = findUserBySubject(db, params.data.subject);
    if (row === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    return reply.code(200).send({
      account: accountView(row),
      grants: listGrantsForSubject(db, row.subject).map(grantView),
      liveSessions: listLiveTokensForSubject(db, row.subject).length,
    });
  });

  /**
   * `POST /console/accounts` — create an account.
   *
   * **It confers nothing.** A new account can reach no app at all until a grant
   * is issued for one, including the owner account — there is no wildcard and no
   * implicit baseline on this path. That is the point: registration stopped being
   * the security boundary when grants became it.
   *
   * `409` on a username taken in any casing, decided by the
   * `users.username_folded` UNIQUE constraint rather than by a lookup first — a
   * SELECT-then-INSERT has a race between the two statements and the constraint
   * does not.
   */
  app.post("/console/accounts", { schema: { response: createSchema } }, async (request, reply) => {
    const body = createAccountBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    // Hashed before the transaction opens: `hashPassword` is async and scrypt
    // takes tens of milliseconds, and better-sqlite3 transactions are
    // synchronous — awaiting inside one is not possible, and holding a write
    // transaction open across an await would be wrong even if it were.
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(body.data.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        // The stable `code`, never the message: the login UI and the console
        // render these, and a message is prose that can be reworded.
        return reply.code(400).send({ error: error.code });
      }
      throw error;
    }

    const db = await database();

    let created: UserRow;
    try {
      created = db.transaction((): UserRow => {
        // `email` is not passed at all — an owner-issued account has none.
        const row = createUser(db, { username: body.data.username, passwordHash });

        recordConsoleAudit(db, request, {
          action: "user.create",
          targetKind: "user",
          targetId: row.subject,
          detail: { username: row.username },
        });

        return row;
      })();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "username_taken" });
      }
      throw error;
    }

    return reply.code(201).send({ account: accountView(created) });
  });

  /**
   * `POST /console/accounts/:subject/disable`
   *
   * Two writes in one transaction: stamp `disabled_at`, and revoke every live
   * refresh token for the subject with reason `admin`. The second is the one
   * that ends the session — see the file header.
   *
   * Idempotent. An already-disabled account is not re-stamped, because
   * `disabled_at` records when it happened and a second click must not rewrite
   * that. The token revocation runs either way (it is one indexed write and
   * `revoked_at`/`revoked_reason` on an already-dead row are left alone), so a
   * repeat still closes anything that somehow survived — and an audit row is
   * written when either half actually changed something.
   */
  app.post("/console/accounts/:subject/disable", { schema: { response: disableSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const before = findUserBySubject(db, params.data.subject);
    if (before === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    const alreadyDisabled = before.disabled_at !== null;

    const result = db.transaction((): { account: UserRow | undefined; sessionsRevoked: number } => {
      if (!alreadyDisabled) {
        setDisabled(db, before.subject, true);
      }

      const sessionsRevoked = revokeAllForSubject(db, before.subject, "admin");

      if (!alreadyDisabled || sessionsRevoked > 0) {
        recordConsoleAudit(db, request, {
          action: "user.disable",
          targetKind: "user",
          targetId: before.subject,
          detail: { username: before.username, sessionsRevoked, alreadyDisabled },
        });
      }

      return { account: findUserBySubject(db, before.subject), sessionsRevoked };
    })();
    if (result.account === undefined) throw new Error("the account was gone after its own disable");

    return reply.code(200).send({
      account: accountView(result.account),
      sessionsRevoked: result.sessionsRevoked,
    });
  });

  /**
   * `POST /console/accounts/:subject/enable`
   *
   * Clears `disabled_at` and nothing else. The grants were never touched, so
   * access returns exactly as it was; the revoked sessions do **not** come back,
   * and the person signs in again.
   *
   * A no-op on an account that is already enabled: `200`, no audit row.
   */
  app.post("/console/accounts/:subject/enable", { schema: { response: enableSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const before = findUserBySubject(db, params.data.subject);
    if (before === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    if (before.disabled_at === null) {
      return reply.code(200).send({ account: accountView(before), changed: false });
    }

    const after = db.transaction((): UserRow | undefined => {
      setDisabled(db, before.subject, false);

      recordConsoleAudit(db, request, {
        action: "user.enable",
        targetKind: "user",
        targetId: before.subject,
        detail: { username: before.username, disabledSince: before.disabled_at },
      });

      return findUserBySubject(db, before.subject);
    })();
    if (after === undefined) throw new Error("the account was gone after its own enable");

    return reply.code(200).send({ account: accountView(after), changed: true });
  });

  /**
   * `POST /console/accounts/:subject/password` — rotate a password.
   *
   * This is the recovery path for an owner-issued account, which by design has
   * no other one: no email, so no reset link. The operator sets a new password
   * and tells the person out of band.
   *
   * **It revokes the account's sessions too**, with reason `admin`, and that is
   * not decoration. The reason to rotate a password is almost always that the
   * old one is no longer trusted, and a rotation that leaves a thirty-day
   * refresh token minting access tokens for whoever holds it has not achieved
   * the thing it was performed for. `db/users.ts` says the same in its
   * `setDisabled` note: a disable or a password change should do both writes.
   *
   * The new password is never logged, never audited and never echoed. The audit
   * row records that a rotation happened and how many sessions it ended.
   */
  app.post("/console/accounts/:subject/password", { schema: { response: passwordSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    const body = passwordBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const account = findUserBySubject(db, params.data.subject);
    if (account === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(body.data.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        return reply.code(400).send({ error: error.code });
      }
      throw error;
    }

    const sessionsRevoked = db.transaction((): number => {
      setPasswordHash(db, account.subject, passwordHash);
      const revoked = revokeAllForSubject(db, account.subject, "admin");

      recordConsoleAudit(db, request, {
        action: "user.password_rotate",
        targetKind: "user",
        targetId: account.subject,
        detail: { username: account.username, sessionsRevoked: revoked },
      });

      return revoked;
    })();

    return reply.code(200).send({ subject: account.subject, sessionsRevoked });
  });
  /**
   * `POST /console/accounts/:subject/username` — rename an account.
   *
   * The subject does not move, and every token, grant and app row keys on the
   * subject, so nothing else changes: no session ends (a rename is not a
   * credential change), and no grant is touched. What does change is the name
   * the person types at Ward's login and the one this console lists. An app's
   * own user keeps the name it took at its first "Sign in with Ward", because
   * `preferred_username` is only ever a suggestion there.
   *
   * The exact same name is a no-op: `200`, `changed: false`, no audit row. A new
   * case of the account's own name is a change, and the constraint allows it,
   * because the folded name still belongs to the same row. A name another
   * account holds is caught by the `UNIQUE` constraint, as on create.
   */
  app.post("/console/accounts/:subject/username", { schema: { response: renameSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    const body = usernameBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const before = findUserBySubject(db, params.data.subject);
    if (before === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    if (before.username === body.data.username) {
      return reply.code(200).send({ account: accountView(before), changed: false });
    }

    let after: UserRow;
    try {
      after = db.transaction((): UserRow => {
        const row = setUsername(db, before.subject, body.data.username);
        if (row === undefined) throw new Error("the account was gone during its own rename");

        recordConsoleAudit(db, request, {
          action: "user.rename",
          targetKind: "user",
          targetId: before.subject,
          detail: { from: before.username, to: row.username },
        });

        return row;
      })();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "username_taken" });
      }
      throw error;
    }

    return reply.code(200).send({ account: accountView(after), changed: true });
  });
  /**
   * `DELETE /console/accounts/:subject` — delete an account outright.
   *
   * The counts are read before the delete, because the cascade takes the rows
   * with it, and the audit row carrying them is the only trace they existed.
   * The apps find out on their next `/session-status` check, which answers
   * `active: false` for an account that is gone, so their Ward-originated
   * sessions end within 30 seconds. Each app keeps its own user and that user's
   * data; deleting those is the app's business.
   */
  app.delete("/console/accounts/:subject", { schema: { response: deleteSchema } }, async (request, reply) => {
    const params = subjectParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const db = await database();
    const row = findUserBySubject(db, params.data.subject);
    if (row === undefined) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    const counts = db.transaction((): { grantsRevoked: number; sessionsRevoked: number } => {
      const grantsRevoked = listGrantsForSubject(db, row.subject).length;
      const sessionsRevoked = listLiveTokensForSubject(db, row.subject).length;
      deleteUser(db, row.subject);

      recordConsoleAudit(db, request, {
        action: "user.delete",
        targetKind: "user",
        targetId: row.subject,
        detail: { username: row.username, grantsRevoked, sessionsRevoked },
      });

      return { grantsRevoked, sessionsRevoked };
    })();

    return reply.code(200).send({ deleted: row.subject, username: row.username, ...counts });
  });
};
