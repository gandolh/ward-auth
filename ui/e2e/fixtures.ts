import type { Page, Route } from "@playwright/test";

import type {
  AccountDetailResult,
  AccountListResult,
  AccountView,
  AppDetailResult,
  AppView,
  AuditListResult,
  AuditRowView,
  ConsoleSessionView,
  GrantView,
  SessionListResult,
} from "../src/console-api";
import type { AccountResult, OpenAppView, SessionResult } from "../src/lib/api";

/**
 * Ward's stand-in for the browser specs: every `/ward-api` request is answered here, so no Ward runs and nothing
 * reaches the API port. The data is the redesign board's: five invented accounts (their subjects as the board's
 * capture drew them), four apps and nine grants, created at 17:04 on 12 Nov 2026, with the browser's clock frozen
 * at 10:00 that day, as the board's capture was. The shapes are the UI's own reply types, so a change to one fails
 * the typecheck here.
 */

/** The browser's clock for every spec: 12 Nov 2026, 10:00 UTC. */
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

const CREATED = "2026-11-12T17:04:00.000Z";

const PEOPLE = [
  ["ada", "aca269198028153b0fe3adfd1712d6cc"],
  ["alex", "473142503450100f9056018471d6d7b7"],
  ["dana", "97250496a2e7364d89c39e36e5d326c4"],
  ["max", "079711c00aca31d79951d632317e61f1"],
  ["sam", "ceacfb253d7645715e27a7ebd8bbb614"],
] as const;

export const ALEX = "473142503450100f9056018471d6d7b7";

const APP_NAMES = [
  ["shelfmark", "Shelfmark"],
  ["satchel", "Satchel"],
  ["almanac", "Almanac"],
  ["lantern", "Lantern"],
] as const;

/** [username, app, role]: alex reaches satchel and shelfmark as a user, as the board draws. */
const GRANTS = [
  ["alex", "satchel", "user"],
  ["alex", "shelfmark", "user"],
  ["ada", "shelfmark", "admin"],
  ["ada", "satchel", "user"],
  ["ada", "almanac", "user"],
  ["dana", "lantern", "user"],
  ["dana", "almanac", "user"],
  ["max", "shelfmark", "user"],
  ["sam", "satchel", "user"],
] as const;

const subjectOf = (username: string): string => PEOPLE.find(([name]) => name === username)?.[1] ?? "";

const ACCOUNTS: AccountView[] = PEOPLE.map(([username, subject]) => ({
  subject,
  username,
  email: null,
  emailVerified: false,
  disabled: false,
  disabledAt: null,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const APPS: AppView[] = APP_NAMES.map(([slug, name]) => ({
  slug,
  name,
  publicRegistration: false,
  baselineRole: null,
  createdAt: CREATED,
  updatedAt: CREATED,
  oidc: { redirectUris: [], postLogoutRedirectUris: [], jwks: null },
}));

const ALL_GRANTS: GrantView[] = GRANTS.map(([username, appSlug, role]) => ({
  subject: subjectOf(username),
  appSlug,
  role,
  grantedAt: CREATED,
  grantedBy: "superuser",
}));

const CONSOLE_SESSION: ConsoleSessionView = {
  id: "107e4153d1ba9965da32bd94b4f979b5",
  createdAt: new Date(NOW).toISOString(),
  lastSeenAt: new Date(NOW).toISOString(),
  idleExpiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  absoluteExpiresAt: new Date(NOW + 4 * 3_600_000).toISOString(),
  idleTimeoutSeconds: 900,
};

/** What Ward's audit log holds after the seed: the apps, the accounts, the grants, then this console sign-in. */
function auditRows(): AuditRowView[] {
  const seed = "d29d8c8c7f441d71078c2a92011a3f93";
  const rows: Omit<AuditRowView, "id">[] = [
    ...APPS.map((app) => ({
      at: CREATED,
      actorKind: "superuser" as const,
      actorSubject: null,
      actorLabel: "superuser",
      action: "app.create",
      targetKind: "app" as const,
      targetId: app.slug,
      detail: { session: seed, name: app.name, publicRegistration: false, baselineRole: null },
    })),
    ...ACCOUNTS.map((account) => ({
      at: CREATED,
      actorKind: "superuser" as const,
      actorSubject: null,
      actorLabel: "superuser",
      action: "user.create",
      targetKind: "user" as const,
      targetId: account.subject,
      detail: { session: seed, username: account.username },
    })),
    ...ALL_GRANTS.map((grant) => ({
      at: CREATED,
      actorKind: "superuser" as const,
      actorSubject: null,
      actorLabel: "superuser",
      action: "grant.create",
      targetKind: "grant" as const,
      targetId: `${grant.subject}:${grant.appSlug}:${grant.role}`,
      detail: { session: seed, subject: grant.subject, appSlug: grant.appSlug, role: grant.role },
    })),
    {
      at: CREATED,
      actorKind: "superuser" as const,
      actorSubject: null,
      actorLabel: "superuser",
      action: "console.login",
      targetKind: "session" as const,
      targetId: CONSOLE_SESSION.id,
      detail: { ip: "127.0.0.1" },
    },
  ];
  return rows.map((row, index) => ({ ...row, id: index + 1 })).reverse();
}

export interface Stub {
  /** The public side's session: alex signed in, or nobody. */
  signedIn?: boolean;
  /** A console session is open. */
  console?: boolean;
  /** Shelfmark takes public signups (the register form's screen). */
  openApps?: boolean;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Answers `/ward-api` from the fixtures above, and freezes the browser's clock. */
export async function stubWard(page: Page, stub: Stub = {}): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.route("**/ward-api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/ward-api/, "");
    const method = route.request().method();
    const signedIn = stub.signedIn === true;

    if (method === "GET" && path === "/session") {
      const body: SessionResult = signedIn
        ? { active: true, subject: ALEX, username: "alex", grants: { satchel: ["user"], shelfmark: ["user"] } }
        : { active: false };
      return json(route, 200, body);
    }
    if (method === "POST" && path === "/refresh") return json(route, 401, { error: "invalid_refresh" });
    if (method === "GET" && path === "/account") {
      const body: AccountResult = {
        subject: ALEX,
        username: "alex",
        email: null,
        emailVerified: false,
        createdAt: CREATED,
      };
      return signedIn ? json(route, 200, body) : json(route, 401, { error: "unauthorized" });
    }
    if (method === "GET" && path === "/apps") {
      const body: OpenAppView[] = stub.openApps === true ? [{ slug: "shelfmark", name: "Shelfmark" }] : [];
      return json(route, 200, body);
    }
    if (method === "GET" && path === "/verify") {
      const token = url.searchParams.get("token");
      if (token === "valid") return json(route, 200, { verified: true });
      if (token === "expired") return json(route, 400, { error: "expired_token" });
      return json(route, 400, { error: "invalid_request" });
    }
    if (method === "POST" && path === "/login") return json(route, 401, { error: "invalid_credentials" });

    if (path.startsWith("/console/")) {
      if (stub.console !== true) return json(route, 401, { error: "unauthorized" });
      return consoleReply(route, method, path.replace(/^\/console/, ""), url.searchParams);
    }
    return json(route, 404, { error: "not_found" });
  });
}

function consoleReply(route: Route, method: string, path: string, query: URLSearchParams): Promise<void> {
  if (method !== "GET") return json(route, 405, { error: "method_not_allowed" });
  if (path === "/session") return json(route, 200, { session: CONSOLE_SESSION });
  if (path === "/accounts") {
    const body: AccountListResult = { accounts: ACCOUNTS, total: ACCOUNTS.length };
    return json(route, 200, body);
  }
  const sessions = /^\/accounts\/([0-9a-f]+)\/sessions$/.exec(path);
  if (sessions !== null) {
    const body: SessionListResult = {
      sessions: [
        {
          familyId: "f97c12a04762d6f2e903f7a0e6264064",
          issuedAt: CREATED,
          expiresAt: "2026-12-12T17:04:00.000Z",
          usedAt: null,
        },
      ],
      total: 1,
    };
    return json(route, 200, body);
  }
  const account = /^\/accounts\/([0-9a-f]+)$/.exec(path);
  if (account !== null) {
    const found = ACCOUNTS.find((row) => row.subject === account[1]);
    if (found === undefined) return json(route, 404, { error: "not_found" });
    const body: AccountDetailResult = {
      account: found,
      grants: ALL_GRANTS.filter((grant) => grant.subject === found.subject),
      liveSessions: 1,
    };
    return json(route, 200, body);
  }
  if (path === "/apps") return json(route, 200, { apps: APPS });
  const app = /^\/apps\/([a-z0-9-]+)$/.exec(path);
  if (app !== null) {
    const found = APPS.find((row) => row.slug === app[1]);
    if (found === undefined) return json(route, 404, { error: "not_found" });
    const body: AppDetailResult = {
      app: found,
      grantCount: ALL_GRANTS.filter((grant) => grant.appSlug === found.slug).length,
    };
    return json(route, 200, body);
  }
  if (path === "/grants") {
    const subject = query.get("subject");
    const slug = query.get("app");
    const grants = ALL_GRANTS.filter(
      (grant) => (subject === null || grant.subject === subject) && (slug === null || grant.appSlug === slug),
    );
    return json(route, 200, { grants });
  }
  if (path === "/audit") {
    const entries = auditRows();
    const body: AuditListResult = { entries, total: entries.length, nextBeforeId: null };
    return json(route, 200, body);
  }
  return json(route, 404, { error: "not_found" });
}
