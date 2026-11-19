import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, seedUser } from "./test-support.js";
import {
  countUsers,
  createUser,
  deleteUser,
  findUserBySubject,
  findUserByUsername,
  findUsersByEmail,
  foldUsername,
  generateSubject,
  listUsers,
  markEmailVerified,
  setDisabled,
  setEmail,
  setPasswordHash,
  setUsername,
  UsernameLookalikeError,
  usernameSkeleton,
} from "./users.js";

let db: Database.Database;

beforeEach(() => {
  db = freshDb();
});

afterEach(() => {
  db.close();
});

describe("generateSubject", () => {
  it("is 128 bits of randomness, hex-encoded", () => {
    const subject = generateSubject();
    expect(subject).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never repeats across a large sample", () => {
    // Not a proof — 128 bits makes a proof unnecessary — but it catches the
    // failure this guards against: a generator quietly turned into a counter,
    // a constant, or a seeded PRNG. Any of those collide immediately here.
    const sample = 50_000;
    const seen = new Set<string>();

    for (let i = 0; i < sample; i += 1) {
      seen.add(generateSubject());
    }

    expect(seen.size).toBe(sample);
  });

  it("is not sequential — successive subjects share no prefix structure", () => {
    // A counter, or a timestamp-derived id, produces neighbouring values whose
    // leading characters barely move. Random ones do not.
    const first = generateSubject();
    const second = generateSubject();

    let common = 0;
    while (common < first.length && first[common] === second[common]) common += 1;

    expect(common).toBeLessThan(8);
  });
});

describe("subjects are unique per account", () => {
  it("two accounts never share one", () => {
    const a = seedUser(db, "alice");
    const b = seedUser(db, "bob");

    expect(a.subject).not.toBe(b.subject);
    expect(findUserBySubject(db, a.subject)?.username).toBe("alice");
    expect(findUserBySubject(db, b.subject)?.username).toBe("bob");
  });

  it("stays true across many accounts written through the real insert path", () => {
    const subjects = new Set<string>();

    for (let i = 0; i < 500; i += 1) {
      subjects.add(seedUser(db, `person-${i}`).subject);
    }

    expect(subjects.size).toBe(500);
    expect(countUsers(db)).toBe(500);
  });

  it("is the database refusing, not the generator — a reused subject is rejected", () => {
    // The generator makes a collision impossible in practice; the PRIMARY KEY
    // makes it impossible in fact. If the generator were ever broken, this is
    // the constraint that turns a silent cross-account data leak into a loud
    // insert failure.
    const alice = seedUser(db, "alice");

    expect(() =>
      createUser(db, {
        subject: alice.subject,
        username: "mallory",
        passwordHash: "scrypt$x",
      }),
    ).toThrowError(/UNIQUE constraint failed: users\.subject/);

    expect(countUsers(db)).toBe(1);
  });
});

describe("username is the canonical identifier", () => {
  it("rejects a second account differing only in case — the schema does it", () => {
    createUser(db, { username: "Alice", passwordHash: "scrypt$x" });

    expect(() => createUser(db, { username: "alice", passwordHash: "scrypt$y" })).toThrowError(
      /UNIQUE constraint failed: users\.username_folded/,
    );
    expect(() => createUser(db, { username: "ALICE", passwordHash: "scrypt$y" })).toThrowError(
      /UNIQUE constraint failed: users\.username_folded/,
    );

    expect(countUsers(db)).toBe(1);
  });

  it("folds beyond ASCII, which a COLLATE NOCASE index would not", () => {
    createUser(db, { username: "Ärger", passwordHash: "scrypt$x" });

    expect(() => createUser(db, { username: "ärger", passwordHash: "scrypt$y" })).toThrowError(
      /UNIQUE constraint failed/,
    );
  });

  it("keeps the casing the person typed, and finds them by any casing", () => {
    const created = createUser(db, { username: "Alice", passwordHash: "scrypt$x" });

    expect(created.username).toBe("Alice");
    expect(created.username_folded).toBe("alice");
    expect(findUserByUsername(db, "ALICE")?.subject).toBe(created.subject);
    expect(findUserByUsername(db, "alice")?.subject).toBe(created.subject);
  });

  it("folds compatibility forms onto their plain equivalents", () => {
    expect(foldUsername("ａlice")).toBe("alice");
  });

  it("a rename keeps the subject — that is what a subject is for", () => {
    const before = seedUser(db, "cristian");
    const after = setUsername(db, before.subject, "gandolh");

    expect(after?.subject).toBe(before.subject);
    expect(after?.username).toBe("gandolh");
    expect(findUserByUsername(db, "cristian")).toBeUndefined();
    expect(findUserByUsername(db, "gandolh")?.subject).toBe(before.subject);
  });

  it("a rename onto a taken name is refused", () => {
    seedUser(db, "alice");
    const bob = seedUser(db, "bob");

    expect(() => setUsername(db, bob.subject, "ALICE")).toThrowError(/UNIQUE constraint failed/);
  });
});

describe("a name that reads the same as another account's is taken", () => {
  /** Escaped, so each fixture says which character it carries. */
  const lookalikes = {
    "Cyrillic а": "\u0430lice",
    "full-width ａ": "\uff41lice",
    "combining grapheme joiner": "alice\u034f",
    "variation selector": "alice\ufe0f",
    "Hangul filler": "alice\u3164",
    "halfwidth Hangul filler": "alice\uffa0",
    "braille blank": "alice\u2800",
  };

  it("gives every look-alike of alice the skeleton alice", () => {
    for (const [label, name] of Object.entries(lookalikes)) {
      expect(usernameSkeleton(name), label).toBe("alice");
    }
    expect(usernameSkeleton("Alice")).toBe("alice");
  });

  it("gives unrelated names their own skeletons", () => {
    expect(usernameSkeleton("bob")).toBe("bob");
    expect(usernameSkeleton("alicia")).not.toBe(usernameSkeleton("alice"));
    expect(usernameSkeleton("cristian g")).toBe("cristian g");
  });

  it("refuses a look-alike at creation and leaves no row behind", () => {
    seedUser(db, "alice");

    for (const [label, name] of Object.entries(lookalikes)) {
      // The full-width one folds onto `alice` (NFKC), so the UNIQUE constraint refuses it first.
      const refusal = label === "full-width ａ" ? /UNIQUE constraint failed/ : UsernameLookalikeError;
      expect(() => createUser(db, { username: name, passwordHash: "scrypt$y" }), label).toThrowError(refusal);
    }
    expect(countUsers(db)).toBe(1);
  });

  it("refuses a rename onto another account's look-alike and keeps the old name", () => {
    seedUser(db, "alice");
    const bob = seedUser(db, "bob");

    expect(() => setUsername(db, bob.subject, "\u0430lice")).toThrowError(UsernameLookalikeError);
    expect(findUserBySubject(db, bob.subject)?.username).toBe("bob");
  });

  it("lets an account take a look-alike of its own name", () => {
    const alice = seedUser(db, "alice");

    expect(setUsername(db, alice.subject, "\u0430lice")?.username_skeleton).toBe("alice");
  });

  it("accepts an unrelated name beside an existing one", () => {
    seedUser(db, "alice");

    expect(createUser(db, { username: "bob", passwordHash: "scrypt$y" }).username_skeleton).toBe("bob");
  });
});

describe("email is optional and never trusted until verified", () => {
  it("defaults to absent and unverified", () => {
    const user = seedUser(db, "owner-issued");

    expect(user.email).toBeNull();
    expect(user.email_verified).toBe(0);
  });

  it("cannot be flagged verified with no address at all", () => {
    const user = seedUser(db, "alice");

    expect(() => db.prepare("UPDATE users SET email_verified = 1 WHERE subject = ?").run(user.subject)).toThrowError(
      /CHECK constraint failed/,
    );
  });

  it("changing the address clears the verified flag", () => {
    const user = seedUser(db, "alice", "alice@example.test");
    markEmailVerified(db, user.subject, "alice@example.test");
    expect(findUserBySubject(db, user.subject)?.email_verified).toBe(1);

    setEmail(db, user.subject, "new@example.test");

    const after = findUserBySubject(db, user.subject);
    expect(after?.email).toBe("new@example.test");
    expect(after?.email_verified).toBe(0);
  });

  it("is not unique, so lookup returns every match", () => {
    seedUser(db, "alice", "shared@example.test");
    seedUser(db, "bob", "shared@example.test");

    expect(findUsersByEmail(db, "shared@example.test")).toHaveLength(2);
  });
});

describe("account lifecycle", () => {
  it("disabling stamps a time and re-enabling clears it, keeping the subject", () => {
    const user = seedUser(db, "alice");

    expect(setDisabled(db, user.subject, true)).toBe(true);
    const disabled = findUserBySubject(db, user.subject);
    expect(disabled?.disabled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(disabled?.subject).toBe(user.subject);

    expect(setDisabled(db, user.subject, false)).toBe(true);
    expect(findUserBySubject(db, user.subject)?.disabled_at).toBeNull();
  });

  it("password and profile writes report whether they hit anything", () => {
    const user = seedUser(db, "alice");

    expect(setPasswordHash(db, user.subject, "scrypt$new")).toBe(true);
    expect(setPasswordHash(db, "no-such-subject", "scrypt$new")).toBe(false);
    expect(findUserBySubject(db, user.subject)?.password_hash).toBe("scrypt$new");
  });

  it("deleting frees the username but retires the subject", () => {
    const alice = seedUser(db, "alice");
    expect(deleteUser(db, alice.subject)).toBe(true);

    // The name can be taken again...
    const reused = seedUser(db, "alice");
    // ...but the subject the apps stored is not handed to the new account.
    expect(reused.subject).not.toBe(alice.subject);
    expect(findUserBySubject(db, alice.subject)).toBeUndefined();
  });

  it("lists accounts in a stable, human order", () => {
    seedUser(db, "Charlie");
    seedUser(db, "alice");
    seedUser(db, "Bob");

    expect(listUsers(db).map((user) => user.username)).toEqual(["alice", "Bob", "Charlie"]);
  });
});
