import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  InvalidUserIdError,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  SESSION_RENEW_INTERVAL_SECONDS,
  createAccounts,
  seedUsers,
  type Accounts,
} from "./accounts.js";
import { UsernamePolicyError, hashSessionToken } from "./identifiers.js";
import { PasswordPolicyError, spendDummyHash } from "./password.js";
import { createSqliteStore, type SqliteAuthStore } from "../store/sqlite.js";
import { UserIdTakenError, UsernameTakenError } from "../store/types.js";

/**
 * Accounts and sessions over a real SQLite store, with an injected clock so
 * expiry and renewal are tested by moving time rather than by waiting.
 */

// Pass-through spy: the real dummy hash runs, and the test can see that it did.
vi.mock("./password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./password.js")>();
  return { ...actual, spendDummyHash: vi.fn(actual.spendDummyHash) };
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 13, 12, 0, 0);

let clock: number;
let store: SqliteAuthStore;
let accounts: Accounts;

beforeEach(() => {
  clock = START;
  store = createSqliteStore(new Database(":memory:"));
  accounts = createAccounts({ store, now: () => clock });
  vi.mocked(spendDummyHash).mockClear();
});

describe("createUser", () => {
  it("mints a 128-bit hex id and hashes the password", async () => {
    const user = await accounts.createUser({
      username: " Alice ",
      password: "correct horse",
      role: "member",
    });

    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      username: "Alice",
      role: "member",
      hasPassword: true,
    });
    const row = store.findUserById(user.id);
    expect(row?.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(row?.usernameFolded).toBe("alice");
  });

  it("keeps an id the app supplies, so migrated rows keep their keys", async () => {
    const subject = "0123456789abcdef0123456789abcdef";
    const user = await accounts.createUser({
      id: subject,
      username: "alice",
      password: "correct horse",
      role: "member",
    });
    expect(user.id).toBe(subject);
  });

  it("refuses an unusable supplied id, and a reused one", async () => {
    await expect(
      accounts.createUser({ id: "has space", username: "a", password: "correct horse", role: "r" }),
    ).rejects.toBeInstanceOf(InvalidUserIdError);

    await accounts.createUser({ id: "x1", username: "a", password: "correct horse", role: "r" });
    await expect(
      accounts.createUser({ id: "x1", username: "b", password: "correct horse", role: "r" }),
    ).rejects.toBeInstanceOf(UserIdTakenError);
  });

  it("treats usernames differing only in case or Unicode form as one", async () => {
    await accounts.createUser({ username: "Alice", password: "correct horse", role: "r" });
    await expect(
      accounts.createUser({ username: "ａlice", password: "correct horse", role: "r" }),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });

  it("refuses control characters, odd whitespace and an empty name", async () => {
    for (const username of ["", "   ", "al\u0000ice", "al ice", "al  ice", "a\tb"]) {
      await expect(
        accounts.createUser({ username, password: "correct horse", role: "r" }),
      ).rejects.toBeInstanceOf(UsernamePolicyError);
    }
  });

  it("applies the password policy", async () => {
    await expect(
      accounts.createUser({ username: "alice", password: "short", role: "r" }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it("creates a user with no local password", async () => {
    const user = await accounts.createUser({ username: "wardonly", role: "member" });
    expect(user.hasPassword).toBe(false);
    expect(store.findUserById(user.id)?.passwordHash).toBeNull();
  });
});

describe("verifyCredentials", () => {
  beforeEach(async () => {
    await accounts.createUser({ username: "alice", password: "correct horse", role: "member" });
  });

  it("accepts the right password under any casing of the name", async () => {
    expect((await accounts.verifyCredentials("ALICE", "correct horse"))?.username).toBe("alice");
  });

  it("rejects a wrong password without the dummy hash, since the real one ran", async () => {
    expect(await accounts.verifyCredentials("alice", "wrong horse")).toBeUndefined();
    expect(spendDummyHash).not.toHaveBeenCalled();
  });

  /**
   * The enumeration defence, asserted structurally: an unknown username and a
   * user with no local password both spend a hash, so neither answers faster
   * than a wrong password does.
   */
  it("spends the dummy hash for an unknown username", async () => {
    expect(await accounts.verifyCredentials("nobody", "correct horse")).toBeUndefined();
    expect(spendDummyHash).toHaveBeenCalledTimes(1);
  });

  it("spends the dummy hash for a user with no local password", async () => {
    await accounts.createUser({ username: "wardonly", role: "member" });
    expect(await accounts.verifyCredentials("wardonly", "")).toBeUndefined();
    expect(await accounts.verifyCredentials("wardonly", "anything")).toBeUndefined();
    expect(spendDummyHash).toHaveBeenCalledTimes(2);
  });
});

describe("sessions", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (
      await accounts.createUser({ username: "alice", password: "correct horse", role: "member" })
    ).id;
  });

  it("stores only the hash of a 32-byte token", async () => {
    const { token, session } = await accounts.startSession(userId);

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(session.idHash).toBe(hashSessionToken(token));
    expect(store.findSession(token)).toBeUndefined();
    expect(session).toMatchObject({
      origin: "local",
      wardSid: null,
      expiresAt: START + SESSION_IDLE_SECONDS * 1000,
    });
  });

  it("resolves a live token to its user, and nothing for junk", async () => {
    const { token } = await accounts.startSession(userId);

    expect((await accounts.resolveSession(token))?.user.username).toBe("alice");
    expect(await accounts.resolveSession("not-a-token")).toBeUndefined();
    expect(await accounts.resolveSession(undefined)).toBeUndefined();
    expect(await accounts.resolveSession("")).toBeUndefined();
  });

  it("does not write on every request: no renewal inside the interval", async () => {
    const { token, session } = await accounts.startSession(userId);
    clock += SESSION_RENEW_INTERVAL_SECONDS * 1000 - 1;

    const resolved = await accounts.resolveSession(token);
    expect(resolved?.renewed).toBe(false);
    expect(store.findSession(session.idHash)?.expiresAt).toBe(session.expiresAt);
  });

  it("slides the idle expiry once the interval has passed", async () => {
    const { token, session } = await accounts.startSession(userId);
    clock += 3 * DAY;

    const resolved = await accounts.resolveSession(token);
    expect(resolved?.renewed).toBe(true);
    expect(resolved?.session.expiresAt).toBe(clock + SESSION_IDLE_SECONDS * 1000);
    expect(store.findSession(session.idHash)?.expiresAt).toBe(clock + SESSION_IDLE_SECONDS * 1000);
  });

  it("ends a session left idle past the idle timeout, and deletes the row", async () => {
    const { token, session } = await accounts.startSession(userId);
    clock += SESSION_IDLE_SECONDS * 1000;

    expect(await accounts.resolveSession(token)).toBeUndefined();
    expect(store.findSession(session.idHash)).toBeUndefined();
  });

  it("never renews past the absolute ceiling, however active", async () => {
    const { token } = await accounts.startSession(userId);
    const ceiling = START + SESSION_ABSOLUTE_SECONDS * 1000;

    // Active every day: always renewed, never idle.
    for (let day = 1; day < 30; day += 1) {
      clock = START + day * DAY;
      const resolved = await accounts.resolveSession(token);
      expect(resolved).toBeDefined();
      expect(resolved!.session.expiresAt).toBeLessThanOrEqual(ceiling);
    }

    clock = ceiling;
    expect(await accounts.resolveSession(token)).toBeUndefined();
  });

  it("refuses a Ward origin without a Ward sid, and a sid on a local session", async () => {
    await expect(accounts.startSession(userId, { origin: "ward" })).rejects.toThrow(TypeError);
    await expect(accounts.startSession(userId, { wardSid: "family" })).rejects.toThrow(TypeError);

    const { session } = await accounts.startSession(userId, { origin: "ward", wardSid: "family" });
    expect(session).toMatchObject({ origin: "ward", wardSid: "family" });
  });

  it("ends one session by token", async () => {
    const a = await accounts.startSession(userId);
    const b = await accounts.startSession(userId);
    await accounts.endSession(a.token);

    expect(await accounts.resolveSession(a.token)).toBeUndefined();
    expect(await accounts.resolveSession(b.token)).toBeDefined();
  });
});

describe("changePassword", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (
      await accounts.createUser({ username: "alice", password: "correct horse", role: "member" })
    ).id;
  });

  it("ends every other session and keeps the one the change came from", async () => {
    const here = await accounts.startSession(userId);
    const laptop = await accounts.startSession(userId);
    const phone = await accounts.startSession(userId);

    expect(
      await accounts.changePassword(userId, "correct horse", "battery staple", here.session.idHash),
    ).toBe(true);

    expect(await accounts.resolveSession(here.token)).toBeDefined();
    expect(await accounts.resolveSession(laptop.token)).toBeUndefined();
    expect(await accounts.resolveSession(phone.token)).toBeUndefined();
    expect(await accounts.verifyCredentials("alice", "battery staple")).toBeDefined();
    expect(await accounts.verifyCredentials("alice", "correct horse")).toBeUndefined();
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const other = await accounts.startSession(userId);
    expect(await accounts.changePassword(userId, "wrong horse", "battery staple")).toBe(false);
    expect(await accounts.resolveSession(other.token)).toBeDefined();
    expect(await accounts.verifyCredentials("alice", "correct horse")).toBeDefined();
  });

  it("checks the new password's policy before anything else", async () => {
    await expect(accounts.changePassword(userId, "wrong horse", "short")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
  });
});

describe("seedUsers", () => {
  it("creates missing users and leaves existing ones exactly as they were", async () => {
    await accounts.createUser({ username: "alice", password: "alice's own", role: "admin" });

    const result = await seedUsers(accounts, [
      { username: "Alice", password: "seeded password", role: "member" },
      { username: "bob", password: "seeded password", role: "member" },
    ]);

    expect(result).toEqual({ created: ["bob"], existing: ["Alice"] });
    // Not reset: the seed never overwrites what a person changed.
    expect(await accounts.verifyCredentials("alice", "alice's own")).toMatchObject({
      role: "admin",
    });
    expect(await accounts.verifyCredentials("bob", "seeded password")).toMatchObject({
      role: "member",
    });

    // And a second run is a no-op.
    expect(
      await seedUsers(accounts, [{ username: "bob", password: "x".repeat(8), role: "r" }]),
    ).toEqual({
      created: [],
      existing: ["bob"],
    });
  });
});
