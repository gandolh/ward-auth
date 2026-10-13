import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createAccounts } from "../core/accounts.js";
import { createSqliteStore } from "../store/sqlite.js";
import { AlreadyLinkedError, WardSubjectTakenError, type AuthStore } from "../store/types.js";
import type { WardIdentity } from "./client.js";
import { NoLocalPasswordError, NotLinkedError, createWardIdentities } from "./identities.js";

/** The linking rules without a Ward; the flow itself is `fastify/ward.test.ts`. */

function setup() {
  const accounts = createAccounts({ store: createSqliteStore(new Database(":memory:")) });
  return { accounts, identities: createWardIdentities({ accounts }) };
}

function identity(overrides: Partial<WardIdentity> = {}): WardIdentity {
  return {
    subject: "s-1",
    username: "alice",
    role: "editor",
    wardSid: "family",
    idToken: "a.b.c",
    ...overrides,
  };
}

describe("createWardIdentities", () => {
  it("refuses a store without the Ward methods", () => {
    const { accounts } = setup();
    const bare: AuthStore = { ...accounts.store } as AuthStore;
    delete (bare as Partial<{ findWardLinkBySubject: unknown }>).findWardLinkBySubject;
    expect(() => createWardIdentities({ accounts: { ...accounts, store: bare } })).toThrow(
      /WardAuthStore/,
    );
  });

  it("creates linked users keyed by the Ward subject, for the migration path", async () => {
    const { identities } = setup();
    const user = await identities.createLinkedUser({
      subject: "0f3a9c",
      id: "0f3a9c",
      username: "alice",
      role: "admin",
    });
    expect(user).toEqual({ id: "0f3a9c", username: "alice", role: "admin", hasPassword: false });
    expect((await identities.findUserBySubject("0f3a9c"))?.id).toBe("0f3a9c");

    // A first Ward sign-in for that subject is that user.
    const signedIn = await identities.userForSignIn(identity({ subject: "0f3a9c" }));
    expect(signedIn).toEqual({ user, created: false });
  });

  it("names a new user from preferred_username, suffixed when taken, never matched", async () => {
    const { accounts, identities } = setup();
    await accounts.createUser({ username: "Alice", password: "a long local password", role: "x" });
    await accounts.createUser({
      username: "alice-2",
      password: "a long local password",
      role: "x",
    });

    const { user, created } = await identities.userForSignIn(identity(), (role) => `ward:${role}`);
    expect(created).toBe(true);
    expect(user.username).toBe("alice-3");
    expect(user.role).toBe("ward:editor");

    const odd = await identities.userForSignIn(identity({ subject: "s-2", username: "  " }));
    expect(odd.user.username).toBe("ward-user");
    const odder = await identities.userForSignIn(identity({ subject: "s-3", username: "\u0007" }));
    expect(odder.user.username).toBe("ward-user-2");
  });

  it("suffixes a name at the length limit without splitting a character", async () => {
    const { accounts, identities } = setup();
    // 253 + 2 (one astral character, a surrogate pair) + 1 = 256 UTF-16 units.
    const long = `${"a".repeat(253)}\u{1F600}b`;
    expect(long.length).toBe(256);
    await accounts.createUser({ username: long, password: "a long local password", role: "x" });

    // Cutting at 254 units would leave half of the pair, which the policy
    // refuses; the cut falls before the whole character instead.
    const { user, created } = await identities.userForSignIn(identity({ username: long }));
    expect(created).toBe(true);
    expect(user.username).toBe(`${"a".repeat(253)}-2`);

    // A cut that lands just after a space drops it.
    const spaced = `${"b".repeat(253)} cd`;
    await accounts.createUser({ username: spaced, password: "a long local password", role: "x" });
    const second = await identities.userForSignIn(identity({ subject: "s-2", username: spaced }));
    expect(second.user.username).toBe(`${"b".repeat(253)}-2`);
  });

  it("links once, idempotently for the same pair, and refuses either side twice", async () => {
    const { accounts, identities } = setup();
    const a = await accounts.createUser({
      username: "a",
      password: "a long local password",
      role: "x",
    });
    const b = await accounts.createUser({
      username: "b",
      password: "a long local password",
      role: "x",
    });

    await identities.link(a.id, "s-a");
    await identities.link(a.id, "s-a");
    await expect(identities.link(a.id, "s-other")).rejects.toBeInstanceOf(AlreadyLinkedError);
    await expect(identities.link(b.id, "s-a")).rejects.toBeInstanceOf(WardSubjectTakenError);
  });

  it("refuses to unlink a user with no local password, or with nothing linked", async () => {
    const { accounts, identities } = setup();
    const wardOnly = await identities.createLinkedUser({ subject: "s", username: "w", role: "x" });
    await expect(identities.unlink(wardOnly.id)).rejects.toBeInstanceOf(NoLocalPasswordError);

    await accounts.setPassword(wardOnly.id, "a long local password");
    const ward = await accounts.startSession(wardOnly.id, { origin: "ward", wardSid: "f" });
    const local = await accounts.startSession(wardOnly.id);
    expect(await identities.unlink(wardOnly.id)).toEqual({ endedSessions: 1 });
    expect(await accounts.resolveSession(ward.token)).toBeUndefined();
    expect(await accounts.resolveSession(local.token)).toBeDefined();

    await expect(identities.unlink(wardOnly.id)).rejects.toBeInstanceOf(NotLinkedError);
  });
});
