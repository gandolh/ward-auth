import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { MailTransport } from "../config.js";
import { APP_KEY_HEADER, resetAppKeyTouchThrottle } from "../auth/app-key.js";
import { createAppKey, revokeAppKey } from "../db/app-keys.js";
import { countAudit, listAudit, type AuditLogRow } from "../db/audit-log.js";
import { grantRole, SUPERUSER_ACTOR } from "../db/grants.js";
import { freshDb, seedAppKey, seedApps, seedUser } from "../db/test-support.js";
import { markEmailVerified, setDisabled, type UserRow } from "../db/users.js";
import {
  createNotifyLimiter,
  NOTIFY_LIMIT,
  NOTIFY_WINDOW_MS,
  notifyRoutes,
  type NotifyLimiter,
} from "./notify.js";

/**
 * `POST /notify` against a Fastify instance this file builds, an in-memory
 * database, and a `file` transport writing `.eml` files to a temp outbox.
 *
 * Nothing here imports `config.ts`: the route takes its database, transport
 * and limiter as options, so no environment is needed and the static imports
 * above are safe.
 */

const FROM = "Ward <ward@gandolh.ro>";

let dir: string;
let outbox: string;
let db: Database.Database;
let app: FastifyInstance;
let prmKey: string;
let atriumKey: string;

/** The people this suite mails, or tries to. */
let alice: UserRow; // verified, prm grant: the one who gets mail
let bob: UserRow; // prm grant, address never verified
let carol: UserRow; // verified, atrium grant only
let dave: UserRow; // verified, prm grant, disabled
let erin: UserRow; // prm grant, no address at all

function fileTransport(target: string): MailTransport {
  return { kind: "file", dir: target, from: FROM };
}

async function build(options: { transport?: MailTransport; limiter?: NotifyLimiter } = {}) {
  const instance = Fastify({ logger: false });
  await instance.register(notifyRoutes, {
    db,
    transport: options.transport ?? fileTransport(outbox),
    ...(options.limiter ? { limiter: options.limiter } : {}),
  });
  await instance.ready();
  return instance;
}

function notify(
  body: unknown,
  key: string | null = prmKey,
  on: FastifyInstance = app,
): Promise<LightMyRequestResponse> {
  return on.inject({
    method: "POST",
    url: "/notify",
    // `null` for no header: `undefined` would take the default.
    headers: key === null ? {} : { [APP_KEY_HEADER]: key },
    payload: body as Record<string, unknown>,
  });
}

const message = (subject: string, overrides: Record<string, unknown> = {}) => ({
  subject,
  mailSubject: "Two new events at Filarmonica",
  text: "Concert on Friday.\nOpen the map: https://gandolh.ro/prm/places/42\n",
  ...overrides,
});

async function outboxFiles(): Promise<string[]> {
  try {
    return await readdir(outbox);
  } catch {
    return [];
  }
}

/** Undo quoted-printable in a message body, then read the bytes as UTF-8. */
function decodeQuotedPrintable(body: string): string {
  const latin = body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(latin, "latin1").toString("utf8");
}

/** Unfold the header block and decode RFC 2047 encoded words in it. */
function decodeHeaders(block: string): string {
  return block
    .replace(/\r?\n[ \t]+/g, " ")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, encoding: string, text: string) =>
      encoding.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQuotedPrintable(text.replace(/_/g, " ")),
    );
}

async function onlyMessage(): Promise<{ headers: string; body: string }> {
  const files = await outboxFiles();
  expect(files).toHaveLength(1);
  const raw = await readFile(join(outbox, files[0]!), "utf8");
  const split = raw.indexOf("\n\n");
  return {
    headers: decodeHeaders(raw.slice(0, split)),
    body: decodeQuotedPrintable(raw.slice(split + 2)),
  };
}

function lastAudit(): AuditLogRow {
  const [row] = listAudit(db, { limit: 1 });
  expect(row).toBeDefined();
  return row!;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ward-notify-"));
  outbox = join(dir, "outbox");

  db = freshDb();
  seedApps(db);
  prmKey = seedAppKey(db, "prm");
  atriumKey = seedAppKey(db, "atrium");

  const verified = (name: string): UserRow => {
    const user = seedUser(db, name, `${name}@example.com`);
    markEmailVerified(db, user.subject, `${name}@example.com`);
    return user;
  };
  const grant = (user: UserRow, appSlug: string): void => {
    grantRole(db, {
      subject: user.subject,
      appSlug,
      role: "user",
      grantedBy: SUPERUSER_ACTOR,
    });
  };

  alice = verified("alice");
  grant(alice, "prm");
  bob = seedUser(db, "bob", "bob@example.com");
  grant(bob, "prm");
  carol = verified("carol");
  grant(carol, "atrium");
  dave = verified("dave");
  grant(dave, "prm");
  setDisabled(db, dave.subject, true);
  erin = seedUser(db, "erin");
  grant(erin, "prm");

  app = await build();
});

afterAll(async () => {
  await app?.close();
  db?.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetAppKeyTouchThrottle();
  await rm(outbox, { recursive: true, force: true });
  db.exec("DELETE FROM audit_log;");
});

describe("the app key comes first", () => {
  it("refuses a call with no key: 401, no mail, no audit row", async () => {
    const response = await notify(message(alice.subject), null);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_app_key" });
    expect(await outboxFiles()).toEqual([]);
    expect(countAudit(db)).toBe(0);
  });

  it("gives malformed, unknown and revoked keys the same 401", async () => {
    const spare = createAppKey(db, {
      appSlug: "prm",
      label: "revoked",
      createdBy: SUPERUSER_ACTOR,
    });
    revokeAppKey(db, spare.row.id);

    for (const key of ["not-a-key", `wak_${"0".repeat(43)}`, spare.key]) {
      const response = await notify(message(alice.subject), key);
      expect(response.statusCode, key).toBe(401);
      expect(response.body).toBe('{"error":"invalid_app_key"}');
    }
    expect(await outboxFiles()).toEqual([]);
    expect(countAudit(db)).toBe(0);
  });

  it("checks the key before parsing the body", async () => {
    // Unparseable JSON with no key is a 401, not Fastify's 400: the hook runs
    // before the body is read.
    const response = await app.inject({
      method: "POST",
      url: "/notify",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("who Ward will mail", () => {
  it("mails a granted, verified user once, framed with the app's name", async () => {
    const response = await notify(message(alice.subject));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: true });
    expect(response.headers["cache-control"]).toBe("no-store");

    const { headers, body } = await onlyMessage();
    // The From name is the app's; the address is Ward's own.
    expect(headers).toMatch(/^From: Public Resource Map via Ward <ward@gandolh\.ro>$/m);
    expect(headers).toMatch(/^To: alice@example\.com$/m);
    expect(headers).toMatch(/^Subject: \[Public Resource Map\] Two new events at Filarmonica$/m);
    expect(headers).not.toMatch(/^Reply-To:/im);

    // The app's text, then the footer naming the app and saying why.
    expect(body).toContain(
      "Concert on Friday.\nOpen the map: https://gandolh.ro/prm/places/42\n\n-- \n",
    );
    expect(body).toContain("Public Resource Map sent you this message through Ward");
    expect(body).toContain("your account has access to Public Resource Map");
    expect(body).toContain("Public Resource Map does not see your email address.");
  });

  it("keeps Romanian text intact in the subject and the body", async () => {
    const response = await notify(
      message(alice.subject, {
        mailSubject: "Mâine: concert la Filarmonică",
        text: "Evenimentul începe la ora 19:00.",
      }),
    );
    expect(response.json()).toEqual({ sent: true });

    const { headers, body } = await onlyMessage();
    expect(headers).toMatch(/^Subject: \[Public Resource Map\] Mâine: concert la Filarmonică$/m);
    expect(body).toContain("Evenimentul începe la ora 19:00.\n\n-- \n");
  });

  it("refuses a subject that holds no grant for the calling app, and sends nothing", async () => {
    const response = await notify(message(carol.subject));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: false });
    expect(await outboxFiles()).toEqual([]);
    expect(JSON.parse(lastAudit().detail!)).toMatchObject({ reason: "no_grant" });
  });

  it("lets an app mail its own users and nobody else's", async () => {
    // alice holds a prm grant and no atrium grant: atrium's key cannot reach her.
    const response = await notify(message(alice.subject), atriumKey);

    expect(response.json()).toEqual({ sent: false });
    expect(await outboxFiles()).toEqual([]);
  });

  it("refuses an unverified address, and sends nothing", async () => {
    const response = await notify(message(bob.subject));

    expect(response.json()).toEqual({ sent: false });
    expect(await outboxFiles()).toEqual([]);
    expect(JSON.parse(lastAudit().detail!)).toMatchObject({ reason: "no_verified_email" });
  });

  it("refuses a disabled account, an account with no address and an unknown subject", async () => {
    const cases: [string, string][] = [
      [dave.subject, "disabled"],
      [erin.subject, "no_verified_email"],
      ["0".repeat(32), "unknown_subject"],
    ];
    for (const [subject, reason] of cases) {
      const response = await notify(message(subject));
      expect(response.json(), reason).toEqual({ sent: false });
      expect(JSON.parse(lastAudit().detail!), reason).toMatchObject({ reason });
    }
    expect(await outboxFiles()).toEqual([]);
  });

  it("gives every refusal the same bytes", async () => {
    const bodies = new Set<string>();
    for (const subject of [carol.subject, bob.subject, dave.subject, erin.subject, "nobody"]) {
      bodies.add((await notify(message(subject))).body);
    }
    bodies.add((await notify({ subject: alice.subject })).body);
    expect([...bodies]).toEqual(['{"sent":false}']);
  });
});

describe("what an app may send", () => {
  it.each([
    ["a From header", { from: "boss@example.com" }],
    ["a Reply-To header", { replyTo: "boss@example.com" }],
    ["headers", { headers: { "X-Priority": "1" } }],
    ["a subject line with a line break", { mailSubject: "Hello\r\nBcc: everyone@example.com" }],
    ["an empty subject line", { mailSubject: "   " }],
    ["a subject line over 200 characters", { mailSubject: "x".repeat(201) }],
    ["empty text", { text: " \n " }],
    ["text over 20,000 characters", { text: "x".repeat(20_001) }],
    ["text with a control character", { text: "bell\u0007" }],
    ["text that is not a string", { text: 42 }],
  ])("refuses %s", async (_, overrides) => {
    const response = await notify(message(alice.subject, overrides));

    expect(response.json()).toEqual({ sent: false });
    expect(await outboxFiles()).toEqual([]);
    expect(JSON.parse(lastAudit().detail!)).toMatchObject({ reason: "invalid_body" });
  });

  it("accepts text at exactly the limits", async () => {
    const response = await notify(
      message(alice.subject, { mailSubject: "s".repeat(200), text: "t".repeat(20_000) }),
    );
    expect(response.json()).toEqual({ sent: true });
  });
});

describe("the audit log", () => {
  it("records every keyed call under the app's slug, without the mail's content", async () => {
    await notify(message(alice.subject));
    await notify(message(carol.subject));
    await notify({ nonsense: true });

    const rows = listAudit(db, { limit: 10 }).reverse();
    expect(rows.map((row) => row.action)).toEqual([
      "notify.sent",
      "notify.refused",
      "notify.refused",
    ]);
    for (const row of rows) {
      expect(row.actor_kind).toBe("system");
      expect(row.actor_label).toBe("app:prm");
      expect(JSON.parse(row.detail!)).toMatchObject({ app: "prm" });
      expect(row.detail).not.toContain("Filarmonica");
      expect(row.detail).not.toContain("Concert");
      expect(row.detail).not.toContain("@example.com");
    }

    expect(rows[0]).toMatchObject({ target_kind: "user", target_id: alice.subject });
    expect(rows[1]).toMatchObject({ target_kind: "user", target_id: carol.subject });
    // A body with no subject has no target, but the call is still recorded.
    expect(rows[2]).toMatchObject({ target_kind: null, target_id: null });
  });
});

describe("a transport failure", () => {
  let broken: FastifyInstance;

  afterEach(async () => {
    await broken?.close();
  });

  it("is a 503 the client can retry, audited as failed, not a refusal", async () => {
    // A file where the outbox directory should be: mkdir fails.
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "");
    broken = await build({ transport: fileTransport(join(blocker, "outbox")) });

    const response = await notify(message(alice.subject), prmKey, broken);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "mail_unavailable" });
    expect(lastAudit()).toMatchObject({ action: "notify.failed", actor_label: "app:prm" });
  });
});

describe("the per-app rate limit", () => {
  let limited: FastifyInstance;

  afterEach(async () => {
    await limited?.close();
  });

  it("refuses past its threshold with the same sent:false, and audits each call", async () => {
    limited = await build({ limiter: createNotifyLimiter(3, 60_000) });

    for (let i = 0; i < 3; i += 1) {
      expect((await notify(message(alice.subject), prmKey, limited)).json()).toEqual({
        sent: true,
      });
    }
    const refused = await notify(message(alice.subject), prmKey, limited);

    expect(refused.statusCode).toBe(200);
    expect(refused.body).toBe('{"sent":false}');
    expect(await outboxFiles()).toHaveLength(3);

    expect(countAudit(db)).toBe(4);
    expect(lastAudit()).toMatchObject({ action: "notify.refused", target_id: alice.subject });
    expect(JSON.parse(lastAudit().detail!)).toMatchObject({ reason: "rate_limited" });
  });

  it("counts each app separately", async () => {
    limited = await build({ limiter: createNotifyLimiter(1, 60_000) });

    expect((await notify(message(alice.subject), prmKey, limited)).json()).toEqual({ sent: true });
    expect((await notify(message(alice.subject), prmKey, limited)).json()).toEqual({
      sent: false,
    });
    // atrium's budget is untouched by prm's: carol holds an atrium grant.
    expect((await notify(message(carol.subject), atriumKey, limited)).json()).toEqual({
      sent: true,
    });
    expect(lastAudit()).toMatchObject({ action: "notify.sent", actor_label: "app:atrium" });
  });
});

describe("createNotifyLimiter with the production numbers", () => {
  it("admits 2,000 calls per app in a rolling day, then refuses", () => {
    expect(NOTIFY_LIMIT).toBe(2_000);
    expect(NOTIFY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    const limiter = createNotifyLimiter();
    const start = 1_800_000_000_000;
    for (let i = 0; i < NOTIFY_LIMIT; i += 1) {
      expect(limiter.take("prm", start + i)).toBe(true);
    }
    expect(limiter.take("prm", start + NOTIFY_LIMIT)).toBe(false);
    // Another app is not affected.
    expect(limiter.take("atrium", start + NOTIFY_LIMIT)).toBe(true);
  });

  it("slides: budget returns as the oldest calls leave the window", () => {
    const limiter = createNotifyLimiter(2, 1_000);

    expect(limiter.take("prm", 0)).toBe(true);
    expect(limiter.take("prm", 500)).toBe(true);
    expect(limiter.take("prm", 999)).toBe(false);
    // The call at 0 leaves the window at 1000; the one at 500 is still in it.
    expect(limiter.take("prm", 1_000)).toBe(true);
    expect(limiter.take("prm", 1_001)).toBe(false);
  });

  it("does not count refused calls, so a loop that stops gets its budget back", () => {
    const limiter = createNotifyLimiter(1, 1_000);

    expect(limiter.take("prm", 0)).toBe(true);
    for (let t = 1; t < 1_000; t += 1) expect(limiter.take("prm", t)).toBe(false);
    expect(limiter.take("prm", 1_000)).toBe(true);
  });
});
