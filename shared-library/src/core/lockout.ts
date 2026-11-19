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
 * ## Attempts still in flight count
 *
 * The budget is recorded failures **plus attempts still running**. A route
 * whose verdict waits on a password hash or a store call takes one of the
 * address's five slots at the gate (`reserveAttempt`) and holds it until the
 * attempt ends, so twenty requests sent at once from one address get five
 * verdicts and fifteen `429`s, not twenty verdicts.
 *
 * ## Per-surface budgets
 *
 * Login, registration, password change and rename hold **independent**
 * budgets. Spending the password-change budget (which needs a session first)
 * must never lock the same address out of login, which is how the person would
 * recover, and a registration flood must not stop existing users signing in.
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
 *
 * Its two imports, `node:net`'s `isIP` and `node:crypto`'s `createHash`, have
 * no side effects.
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";

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
 * addresses only evicts other addresses' counters, which gains the flooder
 * nothing over the attempts they already have.
 *
 * Every key is ASCII and bounded, so the cap bounds bytes too: a counter's key
 * is at most 40 characters for any address `lockoutKeyFor` derives
 * (`bucketKey`), an account's exactly 24 (`accountKey`), however long the
 * submitted name. With the five named accounts the gate lets one counter hold
 * at a time, 10 000 entries carry at most 10 000 × (40 + 5 × 24) = 1.6 MB of
 * key text; even at `LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS` it is
 * 10 000 × (40 + 32 × 24) ≈ 8.1 MB, before the maps' own overhead.
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
export type LockoutSurface = "login" | "register" | "change_password" | "rename";

/** Who is attempting what, from where. */
export interface LockoutTarget {
  surface: LockoutSurface;
  /**
   * From `lockoutKeyFor(...)`, the full address. The counter the `429`
   * decision reads is keyed on it grouped: an IPv4 address whole, an IPv6
   * address by its /64 (`addressGroup`).
   */
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

/**
 * An attempt `reserveAttempt` let through, holding one in-flight slot until it
 * ends. Exactly one of the three ends it; the other two, and a second call of
 * the same one, do nothing after that.
 */
export interface LockoutAttempt {
  /**
   * The credential was wrong: the slot becomes one counted failure, attributed
   * to `account` (folded) exactly as `recordFailure` attributes it.
   */
  fail(account?: string): void;
  /**
   * The credential was right: forgive `account`'s failures as `clearFailures`
   * does, and free the slot. Only for a surface that forgives on success
   * (login, password change): with no `account` it would forgive every failure
   * recorded without one.
   */
  succeed(account?: string): void;
  /**
   * The attempt ended without a verdict that counts (a malformed body, a
   * policy refusal, a thrown error, a success on a surface that forgives
   * nothing): free the slot, count nothing. Every caller calls it in a
   * `finally`, so a slot is never left behind; after `fail` or `succeed` it
   * does nothing.
   */
  release(): void;
}

/** What `reserveAttempt` answers: a slot, or the refusal `check` would give. */
export type LockoutGate = { allowed: true; attempt: LockoutAttempt } | { allowed: false; retryAfterSeconds: number };

/** A lockout counter. One per app process is the expected shape. */
export interface Lockout {
  /**
   * Whether `target`'s address may attempt now. Records nothing. The budget
   * is recorded failures plus attempts still in flight (`reserveAttempt`).
   *
   * A route whose verdict comes after an `await` must gate with
   * `reserveAttempt`, not with this: between this check and a later
   * `recordFailure` the event loop runs other requests' checks, and none of
   * them would see this attempt. `POST <prefix>/register` uses this directly
   * because it records before its first `await`.
   */
  check(target: LockoutTarget): LockoutDecision;
  /**
   * `check` and the count, as one synchronous step: if the attempt is
   * allowed, it takes one of the address's slots before this returns, and
   * holds it until the attempt ends through `fail`, `succeed` or `release`.
   *
   * This is what keeps the budget at five when requests arrive together. A
   * check that reserved nothing lets every request that reaches it before the
   * fifth failure is **recorded** through, and recording waits on a password
   * hash. With a slot taken at the gate, the sixth concurrent request is
   * refused at once and the five already admitted finish.
   *
   * @example
   * const gate = lockout.reserveAttempt({ surface: "login", address });
   * if (!gate.allowed) return tooManyAttempts(reply, gate.retryAfterSeconds);
   * try {
   *   if (!(await verify())) {
   *     gate.attempt.fail(account);
   *     return reply.code(401).send(...);
   *   }
   *   gate.attempt.succeed(account);
   * } finally {
   *   gate.attempt.release();
   * }
   */
  reserveAttempt(target: LockoutTarget): LockoutGate;
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

/**
 * Each lockout's failure map, read by `lockoutStoredKeyLengthForTests` alone.
 * Weak, so a dropped lockout is collected as before.
 */
const storedEntries = new WeakMap<Lockout, Map<string, Entry>>();

/** Reserved breakdown key past `LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS`. */
const OVERFLOW_ACCOUNT_KEY = "+";

/**
 * The bucket key. NUL cannot appear in a surface or an address, so no address
 * can be crafted to land in another surface's bucket.
 */
function bucketKey(target: LockoutTarget): string {
  return `${target.surface}\u0000${addressGroup(target.address)}`;
}

/**
 * The part of an address its budget belongs to: an IPv4 address whole, an
 * IPv6 address by its /64.
 *
 * One IPv6 host is routinely handed a whole /64 and picks its own address
 * inside it (privacy addresses rotate on their own), so keyed on all 128 bits
 * one machine could give every request a fresh address and never meet the
 * fifth failure. A /64 is the smallest subnet address autoconfiguration
 * works in, so a home or a server that has IPv6 at all holds at least one.
 * Every address in it shares one budget, in whatever spelling it arrives
 * (`2001:db8:1:2::a` and `2001:0db8:1:2:0:0:0:a` are one key).
 *
 * Only the counter is grouped. `lockoutKeyFor` still returns the full address,
 * which is what the trusted-peer check compares and what an app logs. An
 * IPv4-mapped address is the IPv4 address it carries, never the mapped
 * prefix's /64: grouped by that, every IPv4 client would share one budget. A
 * string that is not an address is its own key, unchanged.
 */
function addressGroup(address: string): string {
  const bytes = addressBytes(address);
  if (bytes === undefined) return address;

  const ipv4 = bytes.length === 4 ? bytes : mappedIpv4(bytes);
  if (ipv4 !== undefined) return ipv4.join(".");

  return `${formatBytes(bytes.slice(0, 8))}::/64`;
}

/**
 * The breakdown key. Named accounts are prefixed so a username — arbitrary
 * user input — can never collide with the reserved `"*"` (no account named)
 * and `"+"` (overflow) buckets.
 *
 * The name is stored as a digest, never as text: the first 128 bits of its
 * SHA-256, 22 base64url characters, so every named key is 24 characters.
 * A submitted username is capped before folding, and NFKC can lengthen it
 * eighteenfold (U+FDFA folds to 18 characters), so stored as text one failed
 * login could pin kilobytes per name. Cut to a fixed length instead, two long
 * names sharing their first characters would become one account, and a success
 * as one would forgive the failures aimed at the other; at 128 bits two names
 * never meet by accident. `recordFailure` and `clearFailures` both come here,
 * so the digest a failure is filed under is the one a success subtracts.
 */
function accountKey(target: LockoutTarget): string {
  if (target.account === undefined) return "*";
  const digest = createHash("sha256").update(target.account).digest().subarray(0, 16);
  return `a:${digest.toString("base64url")}`;
}

export function createLockout(options: LockoutOptions = {}): Lockout {
  // Wrapped rather than captured, so a test's fake clock is seen.
  const now = options.now ?? (() => Date.now());

  /**
   * Insertion-ordered, which makes eviction an O(1) `next()` on the iterator
   * rather than a scan for the oldest key.
   */
  const entries = new Map<string, Entry>();

  /**
   * Attempts let through by `reserveAttempt` that have not ended yet, by the
   * same key as `entries`.
   *
   * Kept apart from `entries` on purpose: a slot is not a failure, so it never
   * slides a window, never takes a place under `LOCKOUT_MAX_ENTRIES`, and
   * evicting or expiring a failure entry cannot lose one. A key is here only
   * while a request holding it is running, so the map is never larger than the
   * number of requests in flight.
   */
  const inFlight = new Map<string, number>();

  function check(target: LockoutTarget): LockoutDecision {
    const at = now();
    const key = bucketKey(target);
    let entry = entries.get(key);

    if (entry !== undefined && entry.expiresAt <= at) {
      entries.delete(key);
      entry = undefined;
    }

    const failures = entry?.failures ?? 0;
    if (failures + (inFlight.get(key) ?? 0) < LOCKOUT_MAX_FAILURES) return { allowed: true };

    // Refused only because of attempts still running: they end in tens of
    // milliseconds, and if they fail the next request meets the full window
    // anyway, so a second is the honest wait.
    if (entry === undefined || failures < LOCKOUT_MAX_FAILURES) return { allowed: false, retryAfterSeconds: 1 };

    // `Math.max(1, ...)` because `Retry-After: 0` reads as "retry immediately",
    // and a sub-second remainder floors to zero.
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.expiresAt - at) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  function reserveAttempt(target: LockoutTarget): LockoutGate {
    const decision = check(target);
    if (!decision.allowed) return { allowed: false, retryAfterSeconds: decision.retryAfterSeconds ?? 1 };

    const key = bucketKey(target);
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1);

    const { surface, address } = target;
    const withAccount = (account: string | undefined): LockoutTarget =>
      account === undefined ? { surface, address } : { surface, address, account };

    let open = true;
    // Gives the slot back, once. The bookkeeping lives here so `fail` and
    // `succeed` cannot double-count it either.
    const end = (): boolean => {
      if (!open) return false;
      open = false;
      const remaining = (inFlight.get(key) ?? 0) - 1;
      if (remaining > 0) inFlight.set(key, remaining);
      else inFlight.delete(key);
      return true;
    };

    return {
      allowed: true,
      attempt: {
        fail: (account) => {
          // Slot out, failure in, in one synchronous step: the budget the next
          // check reads never dips in between.
          if (end()) recordFailure(withAccount(account));
        },
        succeed: (account) => {
          if (end()) clearFailures(withAccount(account));
        },
        release: () => {
          end();
        },
      },
    };
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

  const lockout: Lockout = { check, reserveAttempt, recordFailure, clearFailures, size: () => entries.size };
  storedEntries.set(lockout, entries);
  return lockout;
}

/**
 * The characters a lockout holds in keys: every counter's key plus every
 * account key in its breakdown. **Tests only** (the byte bound), and
 * deliberately not exported from the bundle's entry point; not a metric.
 */
export function lockoutStoredKeyLengthForTests(lockout: Lockout): number {
  let total = 0;
  for (const [key, entry] of storedEntries.get(lockout) ?? []) {
    total += key.length;
    for (const account of entry.byAccount.keys()) total += account.length;
  }
  return total;
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

/**
 * Epoch milliseconds of the last "no client address" and "ignored
 * X-Forwarded-For" warnings. Process-wide, because the misconfigurations they
 * report are too.
 */
let lastAmbiguousWarnAt = 0;
let lastIgnoredForwardedWarnAt = 0;

/**
 * Forget the warning throttles. **Tests only**, and deliberately not exported
 * from the bundle's entry point.
 */
export function resetLockoutWarningForTests(): void {
  lastAmbiguousWarnAt = 0;
  lastIgnoredForwardedWarnAt = 0;
}

/**
 * One trusted-proxy entry, parsed: an address range a socket peer can fall in.
 *
 * Built only by `parseTrustedProxies`, which is what guarantees the invariants
 * the matcher relies on — `bytes` is 4 or 16 long, `prefix` is in range, and no
 * bit past `prefix` is set.
 */
export interface TrustedProxyRange {
  /** The entry as configured, trimmed. For messages; never matched against. */
  readonly source: string;
  /**
   * The network address: 4 bytes for IPv4, 16 for IPv6. An IPv4-mapped IPv6
   * entry (`::ffff:10.0.0.0/104`) is stored as the IPv4 range it means, because
   * peers are compared in the same normalised form.
   */
  readonly bytes: readonly number[];
  /** How many leading bits of a peer must equal `bytes`. */
  readonly prefix: number;
}

/**
 * The parsed trusted-proxy list `lockoutKeyFor` takes. Parse it **once** — the
 * plugin does it at registration, from its `trustedProxies` option or
 * `AUTH_TRUSTED_PROXIES` — never per request, so a malformed entry is a
 * refusal to start rather than a `500` on every login.
 */
export type TrustedProxies = readonly TrustedProxyRange[];

/** How `lockoutKeyFor` reports a misconfiguration it cannot fix. */
export interface LockoutKeyOptions {
  /**
   * Called — at most once per `LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS`
   * per process for each of two conditions — when the derived key is probably
   * not the client:
   *
   * - no client address could be derived, so every caller shares one bucket;
   * - an `X-Forwarded-For` arrived from a peer that is not trusted and was
   *   ignored, which is what a proxy missing from `trustedProxies` looks like.
   *
   * Shaped `(detail, message)` so a pino logger can be passed straight through.
   */
  warn?: (detail: Record<string, unknown>, message: string) => void;
  /**
   * Peers, beyond loopback, whose `X-Forwarded-For` is believed. From
   * `parseTrustedProxies`. Absent or empty means loopback only, which is the
   * pre-container behaviour: nothing loosens unless it is configured.
   */
  trustedProxies?: TrustedProxies;
}

/**
 * The lockout key for an HTTP request, given the socket peer and whatever
 * `X-Forwarded-For` arrived.
 *
 * ## Why this is not just `request.ip`
 *
 * Every app sits behind Caddy, so **every** request's socket peer is the proxy,
 * not the client. Fastify's `request.ip` is the socket peer unless `trustProxy`
 * is configured — so keying on it gives the entire internet one shared
 * counter, and the sixth failed login anywhere locks out everybody. That is a
 * self-inflicted outage dressed as a security control.
 *
 * ## Why trusting the header here is safe, and only here
 *
 * The header is honoured **only when the peer is loopback or inside a trusted
 * range**, which means the request came through the app's own proxy, and Caddy
 * *appends* the peer it saw. So the **last** element is the address Caddy
 * observed, and a client that sends `X-Forwarded-For: 1.2.3.4` only prepends a
 * value nobody reads. Taking the first element — the usual convention — would
 * be the spoofable choice. It does not walk leftwards past trusted elements
 * either: a trusted range is a Docker bridge network, and anything on it could
 * then pick its bucket by prepending. If the peer is neither, the app is
 * reachable directly and the header is ignored in favour of the socket address.
 *
 * ## Why loopback alone stopped being enough
 *
 * In a container that publishes `127.0.0.1:<port>`, host Caddy reaches the app
 * through Docker's proxy and the peer is a bridge address, never loopback.
 * Loopback-only trust (0.1.0 and 0.2.0) then ignored the header for every
 * request and the whole internet shared one counter — Ward's outage of 2026-10-13.
 * `trustedProxies` names the bridge ranges; loopback is trusted without being
 * listed.
 *
 * ## Both misconfigurations are loud, not silent
 *
 * A trusted peer with no forwarded address still **fails closed** into one
 * shared bucket (a per-request bucket would disable the lockout outright), and
 * says so through `options.warn`. So does a header from an untrusted peer, which
 * is what a proxy missing from `trustedProxies` looks like.
 */
export function lockoutKeyFor(
  socketAddress: string | undefined | null,
  forwardedFor: string | string[] | undefined,
  options: LockoutKeyOptions = {},
): string {
  const peer = normaliseAddress(socketAddress);
  const forwarded = lastForwardedElement(forwardedFor);

  if (peer !== undefined && !isTrustedPeer(peer, options.trustedProxies ?? [])) {
    if (forwarded !== undefined) warnIgnoredForwarded(options.warn, peer);
    return peer;
  }

  // Only an address is a client. The proxy appends the address it saw, so a
  // last element that is anything else (a name, `unknown`, a port glued on)
  // did not come from it, and keying on it would let whoever wrote it name the
  // counter and the address an app logs. Such a request is keyed as if nothing
  // was forwarded. Never an earlier element instead: those are the client's
  // own.
  if (forwarded !== undefined && isIP(forwarded) !== 0) {
    return forwarded;
  }

  // No usable address at all — a trusted caller with no forwarding header or
  // one whose last element is not an address, a Unix socket, or a peer the
  // runtime did not report. One shared bucket is the safe fallback: it
  // throttles rather than letting the attempt through uncounted. Say so, once
  // per interval.
  const bucket = peer ?? "unknown";
  warnAmbiguousAddress(options.warn, peer, bucket);
  return bucket;
}

/**
 * Parse a trusted-proxy list: addresses or CIDR ranges, IPv4 or IPv6, given as
 * an array or as one comma-separated string (`AUTH_TRUSTED_PROXIES`). Blank
 * entries are skipped, so an empty string is an empty list.
 *
 * **Throws** a `TypeError` naming the entry on anything it cannot read exactly.
 * Each refusal is a typo that would otherwise widen or narrow trust silently:
 *
 * - not an address, a prefix out of range, or a zone id;
 * - host bits set past the prefix (`172.19.0.3/16`) — most tools mask that
 *   quietly, but it is as likely a mistyped prefix as a mistyped address;
 * - a `/0`, which trusts every peer and so lets any client that reaches the
 *   service directly pick its own lockout bucket.
 */
export function parseTrustedProxies(entries: string | readonly string[]): TrustedProxies {
  const list = typeof entries === "string" ? entries.split(",") : entries;
  const ranges: TrustedProxyRange[] = [];
  for (const raw of list) {
    const source = raw.trim();
    if (source.length === 0) continue;
    ranges.push(parseRange(source));
  }
  return ranges;
}

function parseRange(source: string): TrustedProxyRange {
  const refuse = (why: string): never => {
    throw new TypeError(`trusted proxy ${JSON.stringify(source)} ${why}`);
  };

  const parts = source.toLowerCase().split("/");
  if (parts.length > 2) refuse("has more than one '/'");
  const [address = "", prefixText] = parts;
  if (address.includes("%")) refuse("carries a zone id, which is not part of an address range");

  let bytes = addressBytes(address) ?? refuse("is not an IPv4 or IPv6 address or CIDR range");
  const width = bytes.length * 8;

  let prefix = width;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > width) {
      refuse(`has a prefix outside /0–/${width}`);
    }
    prefix = Number(prefixText);
  }

  // Stored the way peers are compared: an IPv4-mapped entry is an IPv4 range.
  const mapped = mappedIpv4(bytes);
  if (mapped !== undefined) {
    if (prefix < 96) refuse("is an IPv4-mapped range shorter than /96");
    bytes = mapped;
    prefix -= 96;
  }

  if (prefix === 0) {
    refuse("trusts every address, which would let any client choose its own lockout bucket");
  }

  const network = maskBytes(bytes, prefix);
  if (network.some((byte, index) => byte !== bytes[index])) {
    refuse(`has bits set past /${prefix}; the network is ${formatBytes(network)}/${prefix}`);
  }

  return { source, bytes, prefix };
}

/** Always trusted, listed or not: a loopback peer on the VPS is the proxy. */
const LOOPBACK: TrustedProxies = parseTrustedProxies(["127.0.0.0/8", "::1"]);

function isTrustedPeer(peer: string, trusted: TrustedProxies): boolean {
  const parsed = addressBytes(peer);
  // A peer that is not an address at all (a runtime oddity) is trusted by
  // nobody; it becomes its own bucket, which is the behaviour from before trusted proxies.
  if (parsed === undefined) return false;
  // `normaliseAddress` already unwraps both mapped spellings; this keeps the
  // check right for a peer that did not come through it.
  const bytes = mappedIpv4(parsed) ?? parsed;
  return LOOPBACK.some((range) => inRange(bytes, range)) || trusted.some((range) => inRange(bytes, range));
}

function inRange(bytes: readonly number[], range: TrustedProxyRange): boolean {
  if (bytes.length !== range.bytes.length) return false;
  const masked = maskBytes(bytes, range.prefix);
  return masked.every((byte, index) => byte === range.bytes[index]);
}

function maskBytes(bytes: readonly number[], prefix: number): number[] {
  return bytes.map((byte, index) => {
    const bits = Math.min(8, Math.max(0, prefix - index * 8));
    return byte & ((0xff << (8 - bits)) & 0xff);
  });
}

/**
 * 4 bytes for an IPv4 address, 16 for IPv6, `undefined` for anything else.
 * `isIP` decides what is an address, so leading zeros, short forms like `1.2.3`
 * and stray characters are refused by the same rules Node's sockets use.
 */
function addressBytes(address: string): number[] | undefined {
  const family = isIP(address);
  if (family === 4) return address.split(".").map(Number);
  if (family !== 6 || address.includes("%")) return undefined;

  // A dotted IPv4 tail (`::ffff:10.1.2.3`) becomes two hex groups first.
  let text = address;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head = "", rest] = text.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const restGroups = rest === undefined || rest === "" ? [] : rest.split(":");
  const zeros = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;
  const groups = [...headGroups, ...Array<string>(zeros).fill("0"), ...restGroups];

  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/** The IPv4 address inside an IPv4-mapped IPv6 one (`::ffff:a.b.c.d`). */
function mappedIpv4(bytes: readonly number[]): number[] | undefined {
  if (bytes.length !== 16) return undefined;
  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return isMapped ? bytes.slice(12) : undefined;
}

function formatBytes(bytes: readonly number[]): string {
  if (bytes.length === 4) return bytes.join(".");
  const groups: string[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    groups.push((((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0)).toString(16));
  }
  return groups.join(":");
}

function warnAmbiguousAddress(warn: LockoutKeyOptions["warn"], peer: string | undefined, bucket: string): void {
  if (warn === undefined) return;

  const now = Date.now();
  if (now - lastAmbiguousWarnAt < LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS * 1000) {
    return;
  }
  lastAmbiguousWarnAt = now;

  warn(
    { peer: peer ?? null, bucket },
    "no client address available for the login lockout: the peer is loopback or a trusted " +
      "proxy (or unreported) and no X-Forwarded-For address arrived, so every caller now shares one " +
      "failure counter and five failures anywhere will answer 429 to everybody. Check that " +
      "the reverse proxy sets X-Forwarded-For and that nothing proxies in front of it.",
  );
}

function warnIgnoredForwarded(warn: LockoutKeyOptions["warn"], peer: string): void {
  if (warn === undefined) return;

  const now = Date.now();
  if (now - lastIgnoredForwardedWarnAt < LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS * 1000) {
    return;
  }
  lastIgnoredForwardedWarnAt = now;

  warn(
    { peer },
    "X-Forwarded-For ignored for the login lockout: the peer is not loopback and not in " +
      "AUTH_TRUSTED_PROXIES (wardAuth's trustedProxies), so the lockout keys on the peer " +
      "itself. If the peer is the reverse proxy, every caller now shares one failure counter " +
      "and five failures anywhere will answer 429 to everybody; add the proxy's network to " +
      "AUTH_TRUSTED_PROXIES.",
  );
}

/**
 * The last non-blank `X-Forwarded-For` element, normalised. Not yet known to
 * be an address: `lockoutKeyFor` checks that, so an untrusted peer that sent
 * any header at all is still warned about.
 */
function lastForwardedElement(forwardedFor: string | string[] | undefined): string | undefined {
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
 * Trim, lowercase, strip brackets and an IPv6 zone, and unwrap an IPv4-mapped
 * address in either spelling.
 *
 * `::ffff:127.0.0.1`, `::ffff:7f00:1` and `127.0.0.1` are the same address and
 * must not be three counters, or one client gets three budgets by choosing how
 * to write its address. The same normalisation is why an IPv4-mapped peer
 * matches an IPv4 trusted range. Anything else keeps its full text: an IPv6
 * address is grouped into its /64 only where the counter is keyed
 * (`addressGroup`), never here.
 */
function normaliseAddress(address: string | undefined | null): string | undefined {
  if (address === undefined || address === null) return undefined;

  let value = address.trim().toLowerCase();
  if (value.length === 0) return undefined;

  // `[::1]:1234` and `[::1]` — some proxies bracket IPv6 in X-Forwarded-For.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];

  // An IPv6 scope id (`fe80::1%eth0`) is not part of the address identity.
  // Stripped before the mapped check, so a mapped address with a zone unwraps.
  const percent = value.indexOf("%");
  if (percent !== -1) value = value.slice(0, percent);

  // Read as bytes, so the dotted (`::ffff:203.0.113.9`) and the hex
  // (`::ffff:cb00:7109`) spellings unwrap alike.
  const bytes = addressBytes(value);
  const mapped = bytes === undefined ? undefined : mappedIpv4(bytes);
  if (mapped !== undefined) value = mapped.join(".");

  return value.length > 0 ? value : undefined;
}
