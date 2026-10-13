/**
 * Failed-attempt lockout, keyed on the client address.
 *
 * Ported from Ward's `api/src/auth/lockout.ts`. The rules are Ward's and each
 * one was paid for by a finding there; the only structural change is that the
 * state lives in an **instance** (`createLockout()`) rather than in module
 * scope, so a test needs no reset function and two plugins in one process do
 * not share counters by accident.
 *
 * ## Keyed on the address, never on the username
 *
 * A username-keyed lockout hands any stranger a way to lock a real person out
 * of their own account, for free, by submitting wrong passwords for a name they
 * read off the page. The measure that was supposed to protect the account
 * becomes the attack. An address-keyed counter costs the attacker their own
 * connectivity instead, and the people using these apps are the owner plus a
 * few known people, so a shared address being throttled together is a cost
 * worth paying.
 *
 * ## The decision is on the address; the *forgiveness* is on the account
 *
 * The counter that trips a `429` is keyed on `(surface, address)` and nothing
 * else. But `clearFailures` may only forgive the failures **attributable to
 * the account that just authenticated**, which is why an entry carries a
 * per-account breakdown. Without that split one valid account buys unlimited
 * guessing: interleave four wrong guesses at somebody else with one correct
 * login as yourself and the address never reaches the limit. Ward measured
 * that at ~35 guesses a second before fixing it.
 *
 * ## Per-surface budgets
 *
 * Login, registration and password change hold **independent** budgets.
 * Spending the password-change budget (which needs a session first) must never
 * lock the same address out of login, which is how the person would recover,
 * and a registration flood must not stop existing users signing in.
 *
 * ## No artificial delay
 *
 * There is no `sleep` anywhere here or in the callers. Holding a connection
 * open per failed attempt **is** the denial of service the lockout exists to
 * prevent. Refuse immediately with a `429` and a `Retry-After`.
 *
 * ## In-memory, and it resets on restart
 *
 * A restart forgives every counter, which is fine: the window is 15 minutes
 * and a restart is not something an attacker can cause. Do not grow this into
 * a table without thinking — a write per failed login on an app's only
 * anonymous endpoint is a better amplification target than a bounded map.
 */

/**
 * Failures tolerated before the next attempt is refused. Attempts 1–5 get a
 * `401`; the **sixth** request earns the `429`, because the check runs before
 * the attempt rather than after it.
 */
export const LOCKOUT_MAX_FAILURES = 5;

/**
 * How long a counter survives, in seconds, and therefore how long a lockout
 * lasts once it trips. Every failure pushes the expiry out again, so the window
 * slides: nobody gets a free attempt every 15 minutes by timing the boundary.
 */
export const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/**
 * Hard ceiling on tracked `(surface, address)` pairs. **An uncapped map is the
 * memory-exhaustion DoS this module defends against.** With the cap, flooding
 * addresses only evicts other addresses' counters, which is weaker than the
 * attack the flooder already has. 10 000 entries is roughly a megabyte.
 */
export const LOCKOUT_MAX_ENTRIES = 10_000;

/**
 * How many distinct accounts one address's breakdown names before the rest are
 * lumped into an overflow bucket that `clearFailures` can never name — so a
 * wordlist run keeps counting toward the `429` and is never forgiven.
 */
export const LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS = 32;

/** The shortest interval between two "no client address" warnings, in seconds. */
export const LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS = 5 * 60;

/**
 * Which credential surface a counter belongs to. Each member is an independent
 * budget.
 *
 * **Adding a surface means adding a member here**, not borrowing an existing
 * one. The union is closed so that borrowing is a compile error rather than a
 * quiet coupling nobody notices until the two interfere.
 */
export type LockoutSurface = "login" | "register" | "change_password";

/** Who is attempting what, from where. */
export interface LockoutTarget {
  surface: LockoutSurface;
  /** From `lockoutKeyFor(...)`. The counter the `429` decision is keyed on. */
  address: string;
  /**
   * The account the attempt was aimed at, **folded** (`foldUsername`), so
   * `Alice` and `alice` are one bucket. Only `recordFailure` and
   * `clearFailures` read it; `check` ignores it, because the decision must stay
   * address-wide.
   */
  account?: string;
}

/** The answer to "may this address attempt this right now?". */
export interface LockoutDecision {
  allowed: boolean;
  /** Whole seconds, at least 1, and set **only** when `allowed === false`. */
  retryAfterSeconds?: number;
}

/** A lockout counter. One per app process is the expected shape. */
export interface Lockout {
  /** Whether `target`'s address may attempt now. Records nothing. */
  check(target: LockoutTarget): LockoutDecision;
  /**
   * Count one failed attempt. Call it for **any** credential rejection, and not
   * for a malformed body: that is a client bug, not a guess. Pass `account`
   * even when the name resolved to no row — that bucket must survive somebody
   * else's success.
   */
  recordFailure(target: LockoutTarget): void;
  /** Forget the failures attributable to `target.account`. Call on success. */
  clearFailures(target: LockoutTarget): void;
  /** The number of tracked `(surface, address)` pairs. For tests; not a metric. */
  size(): number;
}

export interface LockoutOptions {
  /** Epoch milliseconds. Injected by tests; `Date.now` otherwise. */
  now?: () => number;
}

interface Entry {
  /** The number the `429` decision reads. Always the sum of `byAccount`. */
  failures: number;
  /** Epoch milliseconds. The counter is gone once the clock passes this. */
  expiresAt: number;
  /** `failures`, split by the account each was aimed at. */
  byAccount: Map<string, number>;
}

/** Reserved breakdown key past `LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS`. */
const OVERFLOW_ACCOUNT_KEY = "+";

/**
 * The bucket key. NUL cannot appear in a surface or an address, so no address
 * can be crafted to land in another surface's bucket.
 */
function bucketKey(target: LockoutTarget): string {
  return `${target.surface}\u0000${target.address}`;
}

/**
 * The breakdown key. Named accounts are prefixed so a username — arbitrary
 * user input — can never collide with the reserved `"*"` (no account named)
 * and `"+"` (overflow) buckets.
 */
function accountKey(target: LockoutTarget): string {
  return target.account === undefined ? "*" : `a:${target.account}`;
}

export function createLockout(options: LockoutOptions = {}): Lockout {
  // Wrapped rather than captured, so a test's fake clock is seen.
  const now = options.now ?? (() => Date.now());

  /**
   * Insertion-ordered, which makes eviction an O(1) `next()` on the iterator
   * rather than a scan for the oldest key.
   */
  const entries = new Map<string, Entry>();

  function check(target: LockoutTarget): LockoutDecision {
    const at = now();
    const key = bucketKey(target);
    const entry = entries.get(key);

    if (entry === undefined) return { allowed: true };

    if (entry.expiresAt <= at) {
      entries.delete(key);
      return { allowed: true };
    }

    if (entry.failures < LOCKOUT_MAX_FAILURES) return { allowed: true };

    // `Math.max(1, ...)` because `Retry-After: 0` reads as "retry immediately",
    // and a sub-second remainder floors to zero.
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.expiresAt - at) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  function recordFailure(target: LockoutTarget): void {
    const at = now();
    const key = bucketKey(target);
    const existing = entries.get(key);

    if (existing !== undefined && existing.expiresAt > at) {
      attribute(existing, accountKey(target));
      existing.failures += 1;
      existing.expiresAt = at + LOCKOUT_WINDOW_SECONDS * 1000;

      // Re-inserted, not merely mutated. A `Map` keeps an existing key's
      // original position and `makeRoom` evicts from the front, so without
      // this the address failing *longest* would be the first counter a flood
      // drops. Delete-then-set makes eviction order least recently failed.
      entries.delete(key);
      entries.set(key, existing);
      return;
    }

    entries.delete(key);
    makeRoom(at);
    entries.set(key, {
      failures: 1,
      expiresAt: at + LOCKOUT_WINDOW_SECONDS * 1000,
      byAccount: new Map([[accountKey(target), 1]]),
    });
  }

  function clearFailures(target: LockoutTarget): void {
    const at = now();
    const key = bucketKey(target);
    const entry = entries.get(key);

    if (entry === undefined) return;
    if (entry.expiresAt <= at) {
      entries.delete(key);
      return;
    }

    const account = accountKey(target);
    const attributable = entry.byAccount.get(account) ?? 0;
    entry.byAccount.delete(account);
    entry.failures -= attributable;

    // Zero means the breakdown is empty; drop it rather than leave a live
    // zero-count entry occupying a slot under the cap.
    if (entry.failures <= 0) entries.delete(key);
  }

  /** Evict until there is space for one more entry: expired first, then oldest. */
  function makeRoom(at: number): void {
    if (entries.size < LOCKOUT_MAX_ENTRIES) return;

    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key);
    }

    while (entries.size >= LOCKOUT_MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  }

  return { check, recordFailure, clearFailures, size: () => entries.size };
}

function attribute(entry: Entry, account: string): void {
  const existing = entry.byAccount.get(account);
  if (existing !== undefined) {
    entry.byAccount.set(account, existing + 1);
    return;
  }

  if (entry.byAccount.size >= LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS) {
    // Past the cap the attribution is lost but the count is not.
    entry.byAccount.set(OVERFLOW_ACCOUNT_KEY, (entry.byAccount.get(OVERFLOW_ACCOUNT_KEY) ?? 0) + 1);
    return;
  }

  entry.byAccount.set(account, 1);
}

/** How `lockoutKeyFor` reports a misconfiguration it cannot fix. */
export interface LockoutKeyOptions {
  /**
   * Called — at most once per `LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS`
   * per process — when no client address could be derived and every caller
   * therefore shares one bucket. Shaped `(detail, message)` so a pino logger
   * can be passed straight through.
   */
  warn?: (detail: Record<string, unknown>, message: string) => void;
}

/**
 * Epoch milliseconds of the last "no client address" warning. Process-wide,
 * because the misconfiguration it reports is too.
 */
let lastAmbiguousWarnAt = 0;

/**
 * Forget the warning throttle. **Tests only**, and deliberately not exported
 * from the bundle's entry point.
 */
export function resetLockoutWarningForTests(): void {
  lastAmbiguousWarnAt = 0;
}

/**
 * The lockout key for an HTTP request, given the socket peer and whatever
 * `X-Forwarded-For` arrived.
 *
 * ## Why this is not just `request.ip`
 *
 * Every app binds loopback behind Caddy, so **every** request's socket peer is
 * `127.0.0.1`. Fastify's `request.ip` is the socket peer unless `trustProxy`
 * is configured — so keying on it gives the entire internet one shared
 * counter, and the sixth failed login anywhere locks out everybody. That is a
 * self-inflicted outage dressed as a security control.
 *
 * ## Why trusting the header here is safe, and only here
 *
 * The header is honoured **only when the peer is loopback**, which on the VPS
 * means the request came through Caddy, and Caddy *appends* the peer it saw.
 * So the **last** element is the address Caddy observed, and a client that
 * sends `X-Forwarded-For: 1.2.3.4` only prepends a value nobody reads. Taking
 * the first element — the usual convention — would be the spoofable choice.
 * If the peer is *not* loopback the app is reachable directly and the header
 * is ignored in favour of the real socket address.
 *
 * ## The loopback-with-no-header case is loud, not silent
 *
 * It still **fails closed** into one shared bucket (a per-request bucket would
 * disable the lockout outright), and says so through `options.warn`.
 */
export function lockoutKeyFor(
  socketAddress: string | undefined | null,
  forwardedFor: string | string[] | undefined,
  options: LockoutKeyOptions = {},
): string {
  const peer = normaliseAddress(socketAddress);

  if (peer !== undefined && !isLoopback(peer)) return peer;

  const forwarded = lastForwardedAddress(forwardedFor);
  if (forwarded !== undefined) return forwarded;

  const bucket = peer ?? "unknown";
  warnAmbiguousAddress(options.warn, peer, bucket);
  return bucket;
}

function warnAmbiguousAddress(
  warn: LockoutKeyOptions["warn"],
  peer: string | undefined,
  bucket: string,
): void {
  if (warn === undefined) return;

  const at = Date.now();
  if (at - lastAmbiguousWarnAt < LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS * 1000) return;
  lastAmbiguousWarnAt = at;

  warn(
    { peer: peer ?? null, bucket },
    "no client address available for the login lockout: the peer is loopback (or unreported) " +
      "and no X-Forwarded-For arrived, so every caller now shares one failure counter and five " +
      "failures anywhere will answer 429 to everybody. Check that the reverse proxy sets " +
      "X-Forwarded-For and that nothing proxies in front of it.",
  );
}

function lastForwardedAddress(forwardedFor: string | string[] | undefined): string | undefined {
  if (forwardedFor === undefined) return undefined;

  // Node collapses repeated headers into an array for most headers; joining and
  // re-splitting handles both shapes with one code path.
  const flat = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const parts = flat
    .split(",")
    .map((part) => normaliseAddress(part))
    .filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

/**
 * Trim, strip an IPv6 zone or an IPv4-mapped prefix, lowercase.
 * `::ffff:127.0.0.1` and `127.0.0.1` must not be two counters.
 */
function normaliseAddress(address: string | undefined | null): string | undefined {
  if (address === undefined || address === null) return undefined;

  let value = address.trim().toLowerCase();
  if (value.length === 0) return undefined;

  // `[::1]:1234` and `[::1]` — some proxies bracket IPv6 in X-Forwarded-For.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];

  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);

  // An IPv6 scope id (`fe80::1%eth0`) is not part of the address identity.
  const percent = value.indexOf("%");
  if (percent !== -1) value = value.slice(0, percent);

  return value.length > 0 ? value : undefined;
}

function isLoopback(address: string): boolean {
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}
