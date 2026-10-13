import { createHash, randomBytes } from "node:crypto";

/**
 * Usernames, user ids and session tokens: the three identifiers the library
 * mints or compares.
 */

/**
 * The longest username accepted, in UTF-16 code units. Ward's own limit, so
 * that every migrated Ward account fits (briefs 22 and 24 carry usernames
 * over).
 */
export const MAX_USERNAME_LENGTH = 256;

/**
 * Ward's username rule, unchanged: runs of visible characters joined by single
 * spaces. `foldUsername` collapses case and Unicode *form*, so `Alice` and
 * `ａlice` cannot become two accounts; what it does not collapse is whitespace
 * and invisible characters, and two accounts that render identically in a
 * user list are a way to grant the wrong person access by clicking the wrong
 * row. So control characters and unusual space-likes are refused outright.
 */
const USERNAME_PATTERN = /^[^\p{C}\p{Zs}]+(?: [^\p{C}\p{Zs}]+)*$/u;

/** Thrown for a username that must never reach the database. */
export class UsernamePolicyError extends Error {
  readonly code = "invalid_username" as const;

  constructor(message: string) {
    super(message);
    this.name = "UsernamePolicyError";
  }
}

/**
 * Trim and validate a username for **storage**. Returns the trimmed value.
 *
 * Login does not call this: a name that could never have been stored cannot
 * match a row, and refusing it early would add a branch before the dummy hash.
 */
export function normaliseUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_USERNAME_LENGTH) {
    throw new UsernamePolicyError(
      `username must be 1 to ${MAX_USERNAME_LENGTH} characters after trimming`,
    );
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new UsernamePolicyError("username contains a control character or unusual whitespace");
  }
  return trimmed;
}

/**
 * The comparison form of a username, and the column the uniqueness constraint
 * sits on. NFKC then lower-case, exactly as Ward folds.
 */
export function foldUsername(username: string): string {
  return username.trim().normalize("NFKC").toLowerCase();
}

/**
 * A new user id: 128 bits from the OS CSPRNG, hex-encoded.
 *
 * **Not a counter and not derived from anything about the account.** A
 * sequential id leaks how many accounts exist and invites guessing; a random
 * one is stable, opaque, and never reused, because nothing in the library
 * deletes a user row.
 */
export function generateUserId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The longest id an app may supply when it migrates rows. Ward subjects are 32
 * hex characters; the slack is for an app whose old ids were something else.
 */
export const MAX_USER_ID_LENGTH = 128;

/**
 * Validate an id an app supplied (briefs 22 and 24 reuse each migrated user's
 * Ward subject so existing rows keep their keys). Printable ASCII without
 * spaces, so an id can sit in a URL, a log line or a foreign key without
 * escaping.
 */
export function isAcceptableUserId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_USER_ID_LENGTH && /^[\x21-\x7e]+$/.test(id);
}

/** Session token entropy in bytes. 256 bits, so guessing one is not a strategy. */
export const SESSION_TOKEN_BYTES = 32;

/**
 * A new session token: 32 random bytes, base64url. This is the cookie value
 * and it is **never stored**; the row holds `hashSessionToken(token)`.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * The stored form of a session token: SHA-256, hex.
 *
 * Why hash at all: a copy of the database (a backup, a support dump) must not
 * be a set of live cookies. Why a fast hash and not scrypt: the token is 256
 * random bits, so there is nothing to brute-force and the hash is on every
 * authenticated request. The lookup is an index hit on the digest, so there is
 * no comparison whose timing could leak a prefix.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
