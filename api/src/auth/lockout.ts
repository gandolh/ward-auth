/**
 * Failed-attempt lockout, keyed on the client address.
 *
 * ## Keyed on IP, never on username — and that is the load-bearing part
 *
 * Newspapper's reasoning generalises: a username-keyed lockout hands any
 * stranger a way to lock a real person out of their own account indefinitely,
 * for free, by submitting wrong passwords for a name they read off a byline.
 * The measure that was supposed to protect the account becomes the attack. An
 * address-keyed counter costs the attacker their own connectivity instead, and
 * the population here is the owner plus a few known people, so a shared address
 * being throttled together is a cost worth paying.
 *
 * ## The decision is on the address; the *forgiveness* is on the account
 *
 * The counter that trips a `429` is keyed on `(surface, address)` and nothing
 * else, so five failures from one address earn the sixth request a `429`
 * whatever usernames they targeted. But `clearFailures` may only forgive the
 * failures **attributable to the account that just authenticated**, and that is
 * why an `Entry` also carries a per-account breakdown.
 *
 * Without that split, one valid account bought unlimited guessing: `/login`
 * cleared the whole address counter on a success, so an attacker with an account
 * of their own could interleave four wrong guesses at somebody else with one
 * correct login as themselves and never see a `429`. Measured at ~35 guesses a
 * second, which is not a rate limit. A success now zeroes only the guesses aimed
 * at the account it proved; guesses aimed anywhere else keep counting.
 *
 * ## Per-surface budgets
 *
 * The key carries a `surface`, so `/login` and `/console/login` hold
 * **independent** budgets. Sharing the *address derivation* (`lockoutKeyFor`) is
 * deliberate and stays — the two endpoints must agree on what an address is, or
 * one machine gets two budgets for the same surface. Sharing the *counter* was
 * not: five wrong `/login` attempts made a correct `/console/login` from the
 * same address answer `429`, and on a one-operator estate behind a home NAT that
 * is the same address. The break-glass credential exists for when things are
 * broken — including when `/login` is under attack — so it cannot share its
 * budget with the surface being attacked. That is the same reasoning as the
 * malformed-body carve-out below.
 *
 * ## No artificial delay
 *
 * There is deliberately no `await sleep(...)` anywhere in this module or in its
 * callers. Holding a connection open for a second per failed attempt **is** the
 * denial of service the lockout exists to prevent: a few hundred concurrent
 * failures would occupy the event loop and Ward's socket budget while doing
 * nothing, and Ward is the runtime dependency of all six apps. Refuse
 * immediately with a `429` and a `Retry-After` and let the client wait.
 *
 * ## Fastify-free on purpose
 *
 * Nothing here imports Fastify, `config.js`, or the database. The console
 * applies the same counter to the superuser console login, and a shared module that
 * drags a web framework or the environment validation along with it would
 * couple two unrelated surfaces. The caller derives the key; `lockoutKeyFor`
 * below is offered as the one-liner for doing that correctly, and it takes its
 * logger as a callback and its trusted proxies as an argument rather than
 * importing either. The two imports, `node:net`'s `isIP` and `node:crypto`'s
 * `createHash`, have no side effects — that is what lets `config.ts` import
 * `parseTrustedProxies` from here and still keep its rule that nothing runs
 * before the environment is validated.
 *
 * ## In-memory, and it resets on restart
 *
 * State lives in one `Map` in this process. A restart therefore forgives every
 * counter, which is fine: the window is 15 minutes and a restart is not
 * something an attacker can cause. It is *not* fine to grow this into a table
 * without thinking — a write per failed login on the estate's only anonymous
 * endpoint is a much more attractive amplification target than a bounded map.
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";

/**
 * Failures tolerated before the next attempt is refused.
 *
 * Five. Note how that reads on the wire: attempts 1–5 get a
 * `401`, and the **sixth** request is the one that earns the `429`, because the
 * check runs before the attempt rather than after it.
 */
export const LOCKOUT_MAX_FAILURES = 5;

/**
 * How long a counter survives, in seconds, and therefore how long a lockout
 * lasts once it trips.
 *
 * Every failure pushes the expiry out to `now + window`, so the window slides:
 * an attacker cannot sit on 5 failures and get a free attempt every 15 minutes
 * by timing them at the boundary.
 */
export const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/**
 * Hard ceiling on tracked `(surface, address)` pairs.
 *
 * **An uncapped map is the memory-exhaustion DoS this module is supposed to be
 * defending against.** One failed login from each of a million spoofed
 * addresses is cheap to send and, uncapped, would be a million entries Ward
 * holds forever. With a cap, the worst an attacker achieves by flooding
 * addresses is evicting other addresses' counters — which is a *weaker* attack
 * than the one they already have (attempting logins directly), so the trade is
 * strictly in our favour.
 *
 * Every key is ASCII and bounded, so the cap bounds bytes too: a counter's key
 * is at most 41 characters for any address `lockoutKeyFor` derives
 * (`bucketKey`), an account's exactly 24 (`accountKey`), however long the
 * submitted name. With the five named accounts the gate lets one counter hold
 * at a time, 10 000 entries carry at most 10 000 × (41 + 5 × 24) ≈ 1.6 MB of
 * key text; even at `LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS` it is
 * 10 000 × (41 + 32 × 24) ≈ 8.1 MB, before the maps' own overhead. Either is
 * far past what this estate sees.
 */
export const LOCKOUT_MAX_ENTRIES = 10_000;

/**
 * How many distinct accounts one address's breakdown will name before the rest
 * are lumped together.
 *
 * The breakdown exists so a success can forgive its own account's failures, and
 * it is fed by anonymous input: without a cap, a wordlist run at one address
 * would grow one map entry per username tried. Past the cap, further accounts
 * are counted under a reserved bucket that `clearFailures` can never name — so
 * the overflow keeps counting toward the `429` and is simply never forgiven,
 * which is the correct direction to fail in.
 */
export const LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS = 32;

/**
 * The shortest interval between two "no client address" warnings, in seconds,
 * and likewise between two "X-Forwarded-For from an untrusted peer" warnings.
 *
 * Both name a misconfiguration that would repeat on **every** request, so they
 * need a throttle or they become the flood they are warning about.
 */
export const LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS = 5 * 60;

/**
 * Which credential surface a counter belongs to.
 *
 * Each member is an **independent budget**, and that is the point: exhausting
 * one must not exhaust another. Review found that `/login` and
 * `/console/login` originally shared one, so anyone could spend the login
 * budget from an address and lock the operator out of the break-glass
 * credential — the one that exists for when `/login` is under attack.
 *
 * - `"login"` — `POST /login`, ordinary accounts.
 * - `"console"` — `POST /console/login`, the break-glass superuser.
 * - `"register"` — `POST /register`, the estate's only anonymous write surface
 *  . It is throttled hardest and shares nothing: a registration
 *   flood must not stop the people who already have accounts from signing in.
 * - `"account_password"` — `POST /account/password`, a person changing their
 *   own password. It takes the **current** password as input, so it is a
 *   credential surface and needs a budget; and it must not be `"login"`,
 *   because the two fail in opposite directions. Guessing a current password
 *   here needs a live session cookie first, so the counter exists to bound a
 *   borrowed laptop or an XSS rather than the open internet — while spending
 *   this budget must never be able to lock the same address out of `/login`,
 *   which is how the person would recover.
 *
 * **Adding a surface means adding a member here**, not borrowing an existing
 * one. The union is closed so that borrowing is a compile error rather than a
 * quiet coupling nobody notices until the two interfere.
 */
export type LockoutSurface = "login" | "console" | "register" | "account_password";

/** Who is attempting what, from where. */
export interface LockoutTarget {
  /** `/login` and `/console/login` hold independent budgets. */
  surface: LockoutSurface;
  /**
   * From `lockoutKeyFor(...)`, the full address. The counter the `429`
   * decision reads is keyed on it grouped: an IPv4 address whole, an IPv6
   * address by its /64 (`addressGroup`).
   */
  address: string;
  /**
   * The account the attempt was aimed at, **folded** (`foldUsername`), so that
   * `Alice` and `alice` are one bucket rather than two.
   *
   * Only `recordFailure` and `clearFailures` read it; `checkLockout` ignores it,
   * because the decision must stay address-wide. Omit it where there is no
   * account to name — the console has exactly one credential — and the failure
   * lands in a single per-address bucket that a console success clears.
   */
  account?: string;
}

/** The answer to "may this address attempt a login right now?". */
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
   * does, and free the slot.
   */
  succeed(account?: string): void;
  /**
   * The attempt ended without a verdict (a malformed body, a thrown error):
   * free the slot, count nothing. Every caller calls it in a `finally`, so a
   * slot is never left behind; after `fail` or `succeed` it does nothing.
   */
  release(): void;
}

/** What `reserveAttempt` answers: a slot, or the refusal `checkLockout` would give. */
export type LockoutGate = { allowed: true; attempt: LockoutAttempt } | { allowed: false; retryAfterSeconds: number };

interface Entry {
  /** The number the `429` decision reads. Always the sum of `byAccount`. */
  failures: number;
  /** Epoch milliseconds. The counter is gone once the clock passes this. */
  expiresAt: number;
  /**
   * `failures`, split by the account each was aimed at. A success may subtract
   * its own account's share and nothing else.
   */
  byAccount: Map<string, number>;
}

/**
 * Insertion-ordered, which is what makes the eviction below an O(1) `next()`
 * on the iterator rather than a scan for the oldest key.
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

/** Epoch milliseconds of the last "no client address" warning. */
let lastAmbiguousWarnAt = 0;

/** Epoch milliseconds of the last "ignored X-Forwarded-For" warning. */
let lastIgnoredForwardedWarnAt = 0;

/**
 * The separator is a NUL, which cannot appear in a `LockoutSurface` and will
 * not appear in an address — so no address can be crafted to land in another
 * surface's bucket.
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
 * Every address in it shares one budget, in whatever spelling it
 * arrives (`2001:db8:1:2::a` and `2001:0db8:1:2:0:0:0:a` are one key).
 *
 * Only the counter is grouped. `lockoutKeyFor` still returns the full address,
 * which is what the trusted-peer check compares and what every row's `ip`
 * records. An IPv4-mapped address is the IPv4 address it carries, never the
 * mapped prefix's /64: grouped by that, every IPv4 client would share one
 * budget. A string that is not an address is its own key, unchanged.
 */
function addressGroup(address: string): string {
  const bytes = addressBytes(address);
  if (bytes === undefined) return address;

  const ipv4 = bytes.length === 4 ? bytes : mappedIpv4(bytes);
  if (ipv4 !== undefined) return ipv4.join(".");

  return `${formatBytes(bytes.slice(0, 8))}::/64`;
}

/**
 * The breakdown key for an attempt.
 *
 * Named accounts are prefixed, so a username — which is arbitrary user input —
 * can never collide with the two reserved buckets: `"*"` for an attempt with no
 * account to name, and `"+"` for the overflow past
 * `LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS`.
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

const OVERFLOW_ACCOUNT_KEY = "+";

/**
 * Whether `target`'s address may attempt a login on `target`'s surface right
 * now. `target.account` is deliberately ignored.
 *
 * Pure with respect to the counter — calling it does not record anything, so a
 * route may call it as its first line without that itself counting as an
 * attempt. It does drop the entry if the window has passed, which is the lazy
 * half of expiry (`recordFailure` does the bulk sweep).
 *
 * The budget is recorded failures **plus attempts still in flight**
 * (`reserveAttempt`): five slots taken by five requests still hashing refuse a
 * sixth just as five recorded failures do.
 *
 * A route whose verdict comes after an `await` must gate with `reserveAttempt`,
 * not with this: between this check and a later `recordFailure` the event loop
 * runs other requests' checks, and none of them would see this attempt.
 * `/register` uses this directly because it records before its first `await`.
 */
export function checkLockout(target: LockoutTarget): LockoutDecision {
  const now = Date.now();
  const key = bucketKey(target);
  let entry = entries.get(key);

  if (entry !== undefined && entry.expiresAt <= now) {
    entries.delete(key);
    entry = undefined;
  }

  const failures = entry?.failures ?? 0;
  if (failures + (inFlight.get(key) ?? 0) < LOCKOUT_MAX_FAILURES) {
    return { allowed: true };
  }

  // Refused only because of attempts still running: they end in tens of
  // milliseconds, and if they fail the next request meets the full window
  // anyway, so a second is the honest wait.
  if (entry === undefined || failures < LOCKOUT_MAX_FAILURES) {
    return { allowed: false, retryAfterSeconds: 1 };
  }

  // `Math.max(1, ...)` because `Retry-After: 0` reads as "retry immediately",
  // which is the opposite of what a locked-out client should be told, and a
  // sub-second remainder floors to zero.
  const retryAfterSeconds = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/**
 * `checkLockout` and the count, as one synchronous step: if the attempt is
 * allowed, it takes one of the address's slots before this returns, and holds
 * it until the attempt ends through `fail`, `succeed` or `release`.
 *
 * This is what keeps the budget at five when requests arrive together. A
 * check that reserved nothing let every request that reached it before the
 * fifth failure was **recorded** through, and recording waits on a password
 * hash; twenty requests sent at once from one address all had their passwords
 * judged. With a slot taken at the gate, the sixth concurrent request is
 * refused at once and the five already admitted finish as before.
 *
 * The caller ends the attempt in a `finally` (`release`), so a thrown error
 * cannot leave a slot taken.
 *
 * @example
 * const gate = reserveAttempt({ surface: "login", address });
 * if (!gate.allowed) return lockedOut(reply, gate.retryAfterSeconds);
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
export function reserveAttempt(target: LockoutTarget): LockoutGate {
  const decision = checkLockout(target);
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

/**
 * Count one failed attempt against `target`.
 *
 * Call this for **any** credential rejection — unknown username, wrong
 * password, wrong superuser password. Not for a malformed request body: that is
 * a client bug rather than a guess, and counting it means a broken integration
 * locks its own users out.
 *
 * Pass `account` even when the username did not resolve to a row: the folded
 * submitted name is exactly the bucket that must survive somebody else's
 * successful login.
 */
export function recordFailure(target: LockoutTarget): void {
  const now = Date.now();
  const key = bucketKey(target);
  const existing = entries.get(key);

  if (existing !== undefined && existing.expiresAt > now) {
    attribute(existing, accountKey(target));
    existing.failures += 1;
    existing.expiresAt = now + LOCKOUT_WINDOW_SECONDS * 1000;

    // Re-inserted, not merely mutated. A `Map` keeps an existing key's original
    // position and `makeRoom` evicts from the front — so without this the
    // address that has been failing *longest* is the first live counter a flood
    // drops, which is precisely backwards and is not what the note in
    // `makeRoom` assumes. Delete-then-set makes eviction order least
    // recently **failed**.
    entries.delete(key);
    entries.set(key, existing);
    return;
  }

  // A new entry (or a resurrected expired one). Make room first so the map can
  // never exceed the cap, then insert — which also puts this key at the back of
  // the insertion order, where eviction reaches it last.
  entries.delete(key);
  makeRoom(now);
  entries.set(key, {
    failures: 1,
    expiresAt: now + LOCKOUT_WINDOW_SECONDS * 1000,
    byAccount: new Map([[accountKey(target), 1]]),
  });
}

function attribute(entry: Entry, account: string): void {
  const existing = entry.byAccount.get(account);
  if (existing !== undefined) {
    entry.byAccount.set(account, existing + 1);
    return;
  }

  if (entry.byAccount.size >= LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS) {
    // Past the cap the attribution is lost but the count is not: the overflow
    // bucket has a reserved key no caller can name, so these failures still
    // trip the `429` and no success ever forgives them.
    entry.byAccount.set(OVERFLOW_ACCOUNT_KEY, (entry.byAccount.get(OVERFLOW_ACCOUNT_KEY) ?? 0) + 1);
    return;
  }

  entry.byAccount.set(account, 1);
}

/**
 * Forget the failures **attributable to `target.account`** from
 * `target.address` on `target.surface`. Called on every **successful**
 * authentication.
 *
 * Without any forgiveness, a person who mistypes their password four times and
 * then gets it right stays one failure away from a lockout for the next quarter
 * of an hour — the counter has to mean "unexplained failures", not "failures".
 *
 * Without the *account* half, one valid account buys unlimited guessing at every
 * other account from the same address. So this subtracts one account's share and
 * leaves the rest of the address's budget spent: guesses aimed elsewhere are not
 * explained by this success and must keep counting.
 */
export function clearFailures(target: LockoutTarget): void {
  const now = Date.now();
  const key = bucketKey(target);
  const entry = entries.get(key);

  if (entry === undefined) return;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return;
  }

  const account = accountKey(target);
  const attributable = entry.byAccount.get(account) ?? 0;
  entry.byAccount.delete(account);
  entry.failures -= attributable;

  // `failures` is the sum of `byAccount`, so zero here means the breakdown is
  // empty and the entry carries nothing. Drop it rather than leaving a live
  // zero-count entry occupying a slot under the cap.
  if (entry.failures <= 0) entries.delete(key);
}

/**
 * Drop all state — every counter, every breakdown, and the warning throttles.
 * **Tests only** — nothing in the running service calls it.
 *
 * The map is module-level, so without this a test that earns a `429` from
 * `127.0.0.1` leaves the next test in the same worker locked out. Call it in a
 * `beforeEach`.
 */
export function resetLockoutForTests(): void {
  entries.clear();
  inFlight.clear();
  lastAmbiguousWarnAt = 0;
  lastIgnoredForwardedWarnAt = 0;
}

/**
 * The number of tracked `(surface, address)` pairs. Exported for the cap test;
 * not a metric.
 */
export function lockoutEntryCountForTests(): number {
  return entries.size;
}

/**
 * The characters held in keys: every counter's key plus every account key in
 * its breakdown. Exported for the byte-bound test; not a metric.
 */
export function lockoutStoredKeyLengthForTests(): number {
  let total = 0;
  for (const [key, entry] of entries) {
    total += key.length;
    for (const account of entry.byAccount.keys()) total += account.length;
  }
  return total;
}

/**
 * Evict until there is space for one more entry: expired first, then oldest.
 */
function makeRoom(now: number): void {
  if (entries.size < LOCKOUT_MAX_ENTRIES) return;

  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }

  // Still full: every entry is live, so this is a flood. Evict from the front,
  // which — because `recordFailure` re-inserts — is the least recently *failed*
  // key. Losing a live counter is acceptable (see LOCKOUT_MAX_ENTRIES); an
  // unbounded map is not.
  while (entries.size >= LOCKOUT_MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    entries.delete(oldest.value);
  }
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
 * The parsed trusted-proxy list `lockoutKeyFor` takes. Parse it **once** — at
 * boot, from `WARD_TRUSTED_PROXIES` — never per request, so a malformed entry
 * is a refusal to start rather than a `500` on every login.
 */
export type TrustedProxies = readonly TrustedProxyRange[];

/** How `lockoutKeyFor` reports a misconfiguration it cannot fix. */
export interface LockoutKeyOptions {
  /**
   * Called — at most once per
   * `LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS` per process for each of
   * two conditions — when the derived key is probably not the client:
   *
   * - no client address could be derived, so every caller shares one bucket;
   * - an `X-Forwarded-For` arrived from a peer that is not trusted and was
   *   ignored, which is what a proxy missing from `trustedProxies` looks like.
   *
   * Shaped `(detail, message)` so a pino logger can be passed straight through:
   * `warn: (detail, message) => request.log.warn(detail, message)`.
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
 * Ward sits behind Caddy, so **every** request's socket peer is the proxy, not
 * the client. Fastify's `request.ip` is the socket peer unless `trustProxy` is
 * configured, and it is not — so keying on `request.ip` would give the entire
 * internet one shared counter, and the sixth failed login anywhere in the
 * estate would lock out everybody. That is a self-inflicted outage dressed as a
 * security control.
 *
 * ## Why trusting the header here is safe, and only here
 *
 * The header is honoured **only when the peer is loopback or inside a trusted
 * range**. Such a peer is the estate's own proxy, and Caddy *appends* the peer
 * it observed to any inbound `X-Forwarded-For` (current Caddy drops an
 * untrusted client's header outright, which is stronger still). So the **last**
 * element is the address Caddy actually saw, and a client that sends
 * `X-Forwarded-For: 1.2.3.4` to spoof its way out of a lockout only succeeds in
 * prepending a value nobody reads. Taking the first element — the usual
 * "original client" convention — would be exactly the spoofable choice.
 *
 * It reads the last element and stops. It does not walk leftwards past
 * elements that are themselves trusted, as multi-hop proxy chains do, because
 * a trusted range here is a Docker bridge network, and anything on it could
 * then choose the bucket by prepending. There is one proxy in front of Ward.
 *
 * If the peer is neither, Ward is being reached directly, the header has no
 * trusted proxy behind it, and it is ignored entirely in favour of the real
 * socket address.
 *
 * ## Why loopback alone stopped being enough
 *
 * Under pm2 on the host the peer really was `127.0.0.1`. In a container that
 * publishes `127.0.0.1:<port>`, host Caddy reaches Ward through Docker's proxy
 * and the peer is a bridge address instead — and locally it is the Caddy
 * container. Loopback-only trust then ignored the header for every request, and
 * five bad passwords from anyone locked everyone out for fifteen minutes (fixed
 * 2026-10-13). `trustedProxies` names those bridge ranges; loopback stays trusted
 * without being listed, because a loopback peer on this box is the proxy by
 * construction.
 *
 * ## Both misconfigurations are loud, not silent
 *
 * A trusted peer that arrives with no forwarded address at all — one of the six
 * apps calling Ward server-side, a second proxy in front of Caddy, a Caddyfile
 * that strips `X-Forwarded-For` — collapses the whole estate into one shared
 * bucket, and the visible symptom is an innocent third party being answered
 * `429`. That is exactly the estate-wide outage the recorded decision claims to
 * avoid, so it must not happen quietly. It still **fails closed** into a shared
 * bucket (a per-request bucket would disable the lockout outright, which is a
 * worse answer), and it says so through `options.warn`.
 *
 * The opposite case warns too: an `X-Forwarded-For` from an untrusted peer.
 * That is either somebody reaching Ward directly with a forged header, or —
 * far likelier — the proxy's own range missing from `trustedProxies`, which is
 * the 2026-10-13 outage. It went unnoticed in production because nothing said so.
 *
 * @example
 * const key = lockoutKeyFor(request.socket.remoteAddress, request.headers["x-forwarded-for"], {
 *   trustedProxies, // parsed once at boot
 *   warn: (detail, message) => request.log.warn(detail, message),
 * });
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
  // counter and the `ip` every log row records. Such a request is keyed as if
  // nothing was forwarded. Never an earlier element instead: those are the
  // client's own.
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
 * an array or as one comma-separated string (`WARD_TRUSTED_PROXIES`). Blank
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

/** Always trusted, listed or not: a loopback peer on this box is the proxy. */
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
      "Caddy sets X-Forwarded-For and that nothing proxies in front of it.",
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
      "WARD_TRUSTED_PROXIES, so the lockout keys on the peer itself. If the peer is the " +
      "reverse proxy, every caller now shares one failure counter and five failures anywhere " +
      "will answer 429 to everybody; add the proxy's network to WARD_TRUSTED_PROXIES.",
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
