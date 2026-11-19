import { CONFUSABLES } from "./confusables.js";
import { foldUsername } from "./identifiers.js";

/**
 * What a username looks like, as a key: the rule that two names which read the
 * same can't belong to two accounts. Ward keys its own accounts the same way
 * (its `usernameSkeleton`), from the same Unicode table.
 */

/** Each confusable character and the prototype it reads as, from `./confusables.ts`. */
const PROTOTYPES: ReadonlyMap<string, string> = new Map(
  CONFUSABLES.split("\n").map((line): [string, string] => {
    const [from = "", to = ""] = line.split(";");
    const codePoints = (hex: string): number[] => hex.split(" ").map((point) => Number.parseInt(point, 16));
    return [String.fromCodePoint(...codePoints(from)), String.fromCodePoint(...codePoints(to))];
  }),
);

/**
 * Characters that render as nothing, or as a blank, and so drop out of a
 * skeleton: Unicode's default-ignorable code points (a combining grapheme
 * joiner, a variation selector, the Hangul fillers), plus U+2800 BRAILLE
 * PATTERN BLANK, which renders as a blank and which Unicode lists as neither
 * ignorable nor confusable.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}⠀]/gu;

/**
 * The key `auth_users.username_skeleton` holds: two names with the same key
 * read the same in an app's list of users, so a new name or a rename onto
 * another account's key is taken (`AuthStore.createUser`, `setUsername`).
 *
 * Three steps, each on the output of the one before:
 *
 *  1. Unicode's skeleton (UTS #39) of the name **as typed**, because apps show
 *     the name as typed: a capital `I` reads as `l`, and a digit `0` as `O`,
 *     so `AIice` reads as `alice` and `b0b` as `bOb`.
 *  2. The fold (`foldUsername`), because case alone never makes two names:
 *     `bOb` becomes `bob`, so `b0b` and `bob` meet.
 *  3. The skeleton again, because lower-casing can make a new look-alike: a
 *     capital `M` becomes `m`, which reads as `rn`, so `MODERN` and `rnodern`
 *     meet.
 *
 * A skeleton is NFD, the invisible characters above removed, each character
 * replaced by its prototype from Unicode's confusables table, then NFD again.
 * A Cyrillic `аlice`, an `alice` with a combining grapheme joiner after it and
 * a full-width `ａlice` all come out as `alice`. In plain ASCII, `I`, `l`, `1`
 * and `|` read the same, `0` reads as `o`, `m` as `rn`, a backtick as `'` and
 * `"` as `''`.
 *
 * Because step 1 sees the capitals, the same name in two cases can have two
 * keys: `Ivan` has `lvan`, and `ivan` has `ivan`. A new `lvan` is taken while
 * `Ivan` exists and not while `ivan` does, which is what each list shows. The
 * two cases themselves are one name either way, through `username_folded`.
 *
 * Pass the stored form of the name (`normaliseUsername`'s answer). The key is
 * never shown to anyone and never compared with anything but another key. The
 * table's version decides some keys, so a new version ships with a migration
 * that recomputes the column.
 */
export function usernameSkeleton(username: string): string {
  return skeleton(foldUsername(skeleton(username)));
}

/** UTS #39's skeleton of `text`, with the invisible characters above dropped. */
function skeleton(text: string): string {
  let mapped = "";
  for (const char of text.normalize("NFD").replace(INVISIBLE, "")) {
    mapped += PROTOTYPES.get(char) ?? char;
  }
  return mapped.normalize("NFD");
}
