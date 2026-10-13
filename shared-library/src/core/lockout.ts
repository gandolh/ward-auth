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
 * request and the whole internet shared one counter — Ward's brief 28.
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
  const forwarded = lastForwardedAddress(forwardedFor);

  if (peer !== undefined && !isTrustedPeer(peer, options.trustedProxies ?? [])) {
    if (forwarded !== undefined) warnIgnoredForwarded(options.warn, peer);
    return peer;
  }

  if (forwarded !== undefined) {
    return forwarded;
  }

  // No usable address at all — a trusted caller with no forwarding header, a
  // Unix socket, or a peer the runtime did not report. One shared bucket is the
  // safe fallback: it throttles rather than letting the attempt through
  // uncounted. Say so, once per interval.
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
  // nobody; it becomes its own bucket, which is the pre-brief-28 behaviour.
  if (parsed === undefined) return false;
  // `normaliseAddress` already unwraps the dotted mapped form Node reports;
  // this catches the hex spelling (`::ffff:ac13:3`) of the same address.
  const bytes = mappedIpv4(parsed) ?? parsed;
  return (
    LOOPBACK.some((range) => inRange(bytes, range)) ||
    trusted.some((range) => inRange(bytes, range))
  );
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
  const isMapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
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

function warnAmbiguousAddress(
  warn: LockoutKeyOptions["warn"],
  peer: string | undefined,
  bucket: string,
): void {
  if (warn === undefined) return;

  const now = Date.now();
  if (now - lastAmbiguousWarnAt < LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS * 1000) {
    return;
  }
  lastAmbiguousWarnAt = now;

  warn(
    { peer: peer ?? null, bucket },
    "no client address available for the login lockout: the peer is loopback or a trusted " +
      "proxy (or unreported) and no X-Forwarded-For arrived, so every caller now shares one " +
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
 *
 * `::ffff:127.0.0.1` and `127.0.0.1` are the same address and must not be two
 * counters — otherwise an attacker gets 2× the attempts by picking a stack. The
 * same normalisation is why an IPv4-mapped peer matches an IPv4 trusted range.
 */
function normaliseAddress(address: string | undefined | null): string | undefined {
  if (address === undefined || address === null) return undefined;

  let value = address.trim().toLowerCase();
  if (value.length === 0) return undefined;

  // `[::1]:1234` and `[::1]` — some proxies bracket IPv6 in X-Forwarded-For.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];

  // Only the dotted spelling is unwrapped here; slicing the prefix off the hex
  // one (`::ffff:ac13:3`) would leave something that is not an address at all.
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(value)) value = value.slice("::ffff:".length);

  // An IPv6 scope id (`fe80::1%eth0`) is not part of the address identity.
  const percent = value.indexOf("%");
  if (percent !== -1) value = value.slice(0, percent);

  return value.length > 0 ? value : undefined;
}
