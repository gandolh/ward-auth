import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { usernameSkeleton } from "./username-skeleton.js";

/** What a username looks like, as a key: the same key Ward gives its own accounts. */

describe("usernameSkeleton", () => {
  /** Escaped, so each fixture says which character it carries. */
  const lookalikes = {
    "Cyrillic а": "аlice",
    "full-width ａ": "ａlice",
    "combining grapheme joiner": "alice͏",
    "variation selector": "alice️",
    "Hangul filler": "aliceㅤ",
    "halfwidth Hangul filler": "aliceﾠ",
    "braille blank": "alice⠀",
  };

  it("gives every look-alike of alice the key alice", () => {
    for (const [label, name] of Object.entries(lookalikes)) {
      expect(usernameSkeleton(name), label).toBe("alice");
    }
    expect(usernameSkeleton("Alice")).toBe("alice");
  });

  it("reads the name as typed, so a capital I or a zero standing in for a letter meets it", () => {
    expect(usernameSkeleton("AIice")).toBe(usernameSkeleton("alice"));
    expect(usernameSkeleton("b0b")).toBe(usernameSkeleton("bob"));
    expect(usernameSkeleton("B0B")).toBe(usernameSkeleton("bob"));
    expect(usernameSkeleton("MODERN")).toBe(usernameSkeleton("rnodern"));
    expect(usernameSkeleton("Аlice")).toBe(usernameSkeleton("alice"));
  });

  it("keys a capital I as l and a small i as i, as each one shows", () => {
    expect(usernameSkeleton("Ivan")).toBe(usernameSkeleton("lvan"));
    expect(usernameSkeleton("ivan")).not.toBe(usernameSkeleton("lvan"));
  });

  it("gives unrelated names their own keys", () => {
    expect(usernameSkeleton("bob")).toBe("bob");
    expect(usernameSkeleton("alicia")).not.toBe(usernameSkeleton("alice"));
    expect(usernameSkeleton("cristian g")).toBe("cristian g");
  });

  it("maps through Ward's table, from the same Unicode file", async () => {
    const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
    const [ours, wards] = await Promise.all([read("./confusables.ts"), read("../../../api/src/db/confusables.ts")]);

    // The two copies differ only in the line naming the module that maps through each.
    const user = / \* in `\.\/[a-z-]+\.ts` uses\./;
    expect(ours).toMatch(user);
    expect(ours.replace(user, "")).toBe(wards.replace(user, ""));
  });
});
