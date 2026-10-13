import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS,
  LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS,
  LOCKOUT_MAX_ENTRIES,
  LOCKOUT_MAX_FAILURES,
  LOCKOUT_WINDOW_SECONDS,
  createLockout,
  lockoutKeyFor,
  resetLockoutWarningForTests,
  type Lockout,
  type LockoutTarget,
} from "./lockout.js";

/**
 * The lockout counter, ported from Ward with its tests. The rules are Ward's;
 * the shape differs in one way — state lives in an instance from
 * `createLockout()` — so each test gets a fresh one instead of a reset call.
 * Ward's `console` and `account_password` surfaces are `register` and
 * `change_password` here.
 */

/** Login from one address, aimed at one account. The common case. */
function login(address: string, account?: string): LockoutTarget {
  return account === undefined
    ? { surface: "login", address }
    : { surface: "login", address, account };
}

/** Registration from one address. No account: nothing to forgive. */
function register_(address: string): LockoutTarget {
  return { surface: "register", address };
}

let lockout: Lockout;

beforeEach(() => {
  lockout = createLockout({ now: () => Date.now() });
  resetLockoutWarningForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkLockout / recordFailure", () => {
  it("allows an address it has never seen", () => {
    expect(lockout.check(login("203.0.113.9"))).toEqual({ allowed: true });
  });

  it("allows the first five failures and refuses the sixth attempt", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      expect(lockout.check(login("203.0.113.9")).allowed).toBe(true);
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }

    const decision = lockout.check(login("203.0.113.9"));
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(LOCKOUT_WINDOW_SECONDS);
  });

  it("sets retryAfterSeconds only when it refuses", () => {
    expect(lockout.check(login("203.0.113.9")).retryAfterSeconds).toBeUndefined();
    lockout.recordFailure(login("203.0.113.9", "alice"));
    expect(lockout.check(login("203.0.113.9")).retryAfterSeconds).toBeUndefined();
  });

  it("counts each address separately", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }

    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
    // The whole reason the key is an address: one address exhausting its
    // attempts must not affect anybody else.
    expect(lockout.check(login("198.51.100.4")).allowed).toBe(true);
  });

  it("checkLockout does not itself count as an attempt", () => {
    for (let i = 0; i < 20; i += 1) lockout.check(login("203.0.113.9"));
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(true);
  });

  it("decides on the address alone, whatever accounts the guesses named", () => {
    // The decision must NOT be per-account, or a wordlist gets a fresh budget
    // for every username it tries.
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login("203.0.113.9", `victim-${i}`));
    }

    expect(lockout.check(login("203.0.113.9", "someone-else")).allowed).toBe(false);
  });
});

describe("clearFailures", () => {
  it("forgives the counter, so four typos then a success is not a near-lockout", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES - 1; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }
    lockout.clearFailures(login("203.0.113.9", "alice"));

    // A full fresh allowance, not one attempt away from a 429.
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      expect(lockout.check(login("203.0.113.9")).allowed).toBe(true);
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });

  it("forgives only the account that authenticated, never the guesses aimed elsewhere", () => {
    /**
     * The finding: one valid account bought unlimited guessing. Four wrong
     * guesses at a victim, one correct login as the attacker's own account, and
     * the whole address counter went back to zero — 40 wrong guesses from one
     * address with no `429` at all.
     */
    for (let i = 0; i < 4; i += 1) lockout.recordFailure(login("203.0.113.9", "victim"));

    lockout.clearFailures(login("203.0.113.9", "attacker"));

    // The victim's four are still counted, so the fifth trips the budget and
    // the sixth request is refused.
    lockout.recordFailure(login("203.0.113.9", "victim"));
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });

  it("subtracts one account's share and leaves the rest of the budget spent", () => {
    lockout.recordFailure(login("203.0.113.9", "victim"));
    lockout.recordFailure(login("203.0.113.9", "victim"));
    lockout.recordFailure(login("203.0.113.9", "alice"));

    lockout.clearFailures(login("203.0.113.9", "alice"));

    // Two failures survive, so three more are tolerated and the fourth is not.
    for (let i = 0; i < 3; i += 1) {
      expect(lockout.check(login("203.0.113.9")).allowed).toBe(true);
      lockout.recordFailure(login("203.0.113.9", "victim"));
    }
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });

  it("drops the entry entirely once nothing is left attributed to it", () => {
    lockout.recordFailure(login("203.0.113.9", "alice"));
    lockout.recordFailure(login("203.0.113.9", "alice"));
    expect(lockout.size()).toBe(1);

    lockout.clearFailures(login("203.0.113.9", "alice"));
    // Not a live zero-count entry occupying a slot under the cap.
    expect(lockout.size()).toBe(0);
  });

  it("never forgives the overflow past the per-address account cap", () => {
    // The breakdown is fed by anonymous input, so it is capped. Past the cap
    // the attribution is lost but the COUNT is not, and no success clears it.
    for (let i = 0; i < LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS + 5; i += 1) {
      lockout.recordFailure(login("203.0.113.9", `guess-${i}`));
    }

    for (let i = 0; i < LOCKOUT_MAX_ACCOUNTS_PER_ADDRESS + 5; i += 1) {
      lockout.clearFailures(login("203.0.113.9", `guess-${i}`));
    }

    // The five that landed in the overflow bucket are still counted.
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });
});

describe("per-surface budgets", () => {
  /**
   * Ward's finding, both directions: when two surfaces shared one budget, five
   * wrong attempts at one made a correct attempt at the other answer `429`.
   * Here that would let a registration flood lock existing users out of login.
   */
  it("exhausting /login leaves /register untouched", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES + 1; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }

    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
    expect(lockout.check(register_("203.0.113.9"))).toEqual({ allowed: true });
  });

  it("exhausting /register leaves /login untouched", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES + 1; i += 1) {
      lockout.recordFailure(register_("203.0.113.9"));
    }

    expect(lockout.check(register_("203.0.113.9")).allowed).toBe(false);
    expect(lockout.check(login("203.0.113.9"))).toEqual({ allowed: true });
  });

  it("clearing one surface does not clear the other", () => {
    for (let i = 0; i < 3; i += 1) lockout.recordFailure(register_("203.0.113.9"));
    for (let i = 0; i < 3; i += 1) lockout.recordFailure(login("203.0.113.9", "alice"));

    lockout.clearFailures(login("203.0.113.9", "alice"));

    // Registration's three survive: two more are tolerated, the third is not.
    for (let i = 0; i < 2; i += 1) {
      expect(lockout.check(register_("203.0.113.9")).allowed).toBe(true);
      lockout.recordFailure(register_("203.0.113.9"));
    }
    expect(lockout.check(register_("203.0.113.9")).allowed).toBe(false);
  });

  it("counts the two surfaces as two entries, not one", () => {
    lockout.recordFailure(login("203.0.113.9", "alice"));
    lockout.recordFailure(register_("203.0.113.9"));
    expect(lockout.size()).toBe(2);
  });

  /**
   * `POST /password` takes the **current** password as input, so it is
   * a credential surface and gets its own member. Borrowing `"login"` would be
   * worse here than the registration case above: guessing a current password would
   * spend the budget for the login form, which is precisely how the person
   * would recover from having had their password changed under them.
   */
  it("gives /password its own budget in both directions", () => {
    const selfService = (address: string, account?: string): LockoutTarget =>
      account === undefined
        ? { surface: "change_password", address }
        : { surface: "change_password", address, account };

    for (let i = 0; i < LOCKOUT_MAX_FAILURES + 1; i += 1) {
      lockout.recordFailure(selfService("203.0.113.9", "alice"));
    }

    expect(lockout.check(selfService("203.0.113.9")).allowed).toBe(false);
    expect(lockout.check(login("203.0.113.9"))).toEqual({ allowed: true });
    expect(lockout.check(register_("203.0.113.9"))).toEqual({ allowed: true });

    // And the other way round.
    lockout = createLockout({ now: () => Date.now() });
    for (let i = 0; i < LOCKOUT_MAX_FAILURES + 1; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
    expect(lockout.check(selfService("203.0.113.9"))).toEqual({ allowed: true });
  });
});

describe("expiry", () => {
  it("forgets a counter once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));

    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);

    vi.setSystemTime(new Date(Date.now() + (LOCKOUT_WINDOW_SECONDS + 1) * 1000));
    expect(lockout.check(login("203.0.113.9"))).toEqual({ allowed: true });
    // And the entry is actually gone, not merely reported as allowed.
    expect(lockout.size()).toBe(0);
  });

  it("slides the window forward on each failure", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));

    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }

    // Wait most of the window, then fail once more. A fixed window would expire
    // on schedule and hand out a free attempt every 15 minutes; a sliding one
    // pushes the expiry out.
    vi.setSystemTime(new Date(Date.now() + (LOCKOUT_WINDOW_SECONDS - 10) * 1000));
    lockout.recordFailure(login("203.0.113.9", "alice"));

    vi.setSystemTime(new Date(Date.now() + 20 * 1000));
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });
});

describe("the cap", () => {
  it("never exceeds LOCKOUT_MAX_ENTRIES, because an uncapped map is the DoS", () => {
    // One failed login from each of many spoofed addresses is cheap to send.
    // Uncapped, that is one map entry each, held for the life of the process.
    for (let i = 0; i < LOCKOUT_MAX_ENTRIES + 500; i += 1) {
      lockout.recordFailure(login(`10.0.${Math.floor(i / 256)}.${i % 256}`, "alice"));
    }

    expect(lockout.size()).toBeLessThanOrEqual(LOCKOUT_MAX_ENTRIES);
  });

  it("evicts the oldest entries first, so a recent locked-out address survives a flood", () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login("203.0.113.9", "alice"));
    }
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);

    // A flood just under the cap: the attacker's own addresses fill the map
    // from the front, and 203.0.113.9 was inserted before them...
    for (let i = 0; i < LOCKOUT_MAX_ENTRIES - 10; i += 1) {
      lockout.recordFailure(login(`10.0.${Math.floor(i / 256)}.${i % 256}`, "alice"));
    }

    // ...so it is still there. Eviction only reaches it once the flood exceeds
    // the whole cap, which is documented as an accepted loss: the worst an
    // attacker gains is the attempts they already had.
    expect(lockout.check(login("203.0.113.9")).allowed).toBe(false);
  });

  it("evicts least recently FAILED, so a still-failing address is not the first to go", () => {
    /**
     * The finding: `recordFailure` incremented an existing entry in place, and a
     * `Map` keeps an existing key's original position. Combined with
     * front-first eviction that made the address which had been failing
     * *longest* the first live counter a flood dropped — precisely backwards,
     * and not what the note in `makeRoom` assumes. Delete-then-set fixes it.
     */
    const attacker = "198.51.100.7";

    // Inserted first, so under the old behaviour it sat at position zero for
    // the rest of its life.
    lockout.recordFailure(login(attacker, "alice"));

    for (let i = 0; i < LOCKOUT_MAX_ENTRIES - 50; i += 1) {
      lockout.recordFailure(login(`10.1.${Math.floor(i / 256)}.${i % 256}`, "alice"));
    }

    // It keeps failing — it is the *most* recently failed key by the end of
    // this loop, and therefore the last thing eviction should reach.
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      lockout.recordFailure(login(attacker, "alice"));
    }
    expect(lockout.check(login(attacker)).allowed).toBe(false);

    // Now push the map over the cap. Eviction takes from the front, which is
    // now the earliest of the flood rather than the attacker.
    for (let i = 0; i < 200; i += 1) {
      lockout.recordFailure(login(`10.2.${Math.floor(i / 256)}.${i % 256}`, "alice"));
    }

    expect(lockout.size()).toBeLessThanOrEqual(LOCKOUT_MAX_ENTRIES);
    expect(lockout.check(login(attacker)).allowed).toBe(false);
  });
});

describe("lockoutKeyFor", () => {
  it("uses the last X-Forwarded-For element when the peer is loopback", () => {
    // Caddy appends the peer it observed, so the last element is the one a
    // client cannot control. Taking the first — the usual "original client"
    // convention — is the spoofable choice.
    expect(lockoutKeyFor("127.0.0.1", "1.2.3.4, 203.0.113.9")).toBe("203.0.113.9");
    expect(lockoutKeyFor("::1", "203.0.113.9")).toBe("203.0.113.9");
    expect(lockoutKeyFor("127.0.0.1", ["1.2.3.4", "203.0.113.9"])).toBe("203.0.113.9");
  });

  it("ignores X-Forwarded-For entirely when the peer is not loopback", () => {
    // The app reachable directly means there is no trusted proxy behind the
    // header, so a client could otherwise pick its own bucket at will.
    expect(lockoutKeyFor("203.0.113.9", "10.0.0.1")).toBe("203.0.113.9");
  });

  it("falls back to the peer when there is no forwarding header", () => {
    expect(lockoutKeyFor("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(lockoutKeyFor("127.0.0.1", "")).toBe("127.0.0.1");
    expect(lockoutKeyFor("127.0.0.1", " , ")).toBe("127.0.0.1");
  });

  it("treats an IPv4-mapped address as the same address", () => {
    // Otherwise picking a stack doubles the allowance.
    expect(lockoutKeyFor("127.0.0.1", "::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(lockoutKeyFor("::ffff:203.0.113.9", undefined)).toBe("203.0.113.9");
  });

  it("normalises brackets, ports and IPv6 zone ids", () => {
    expect(lockoutKeyFor("127.0.0.1", "[2001:db8::1]:4711")).toBe("2001:db8::1");
    expect(lockoutKeyFor("fe80::1%eth0", undefined)).toBe("fe80::1");
    expect(lockoutKeyFor("127.0.0.1", "  203.0.113.9  ")).toBe("203.0.113.9");
  });

  it("returns a single bucket rather than nothing when there is no address", () => {
    // Throttling an unidentifiable caller is the safe direction; letting the
    // attempt through uncounted is not.
    expect(lockoutKeyFor(undefined, undefined)).toBe("unknown");
    expect(lockoutKeyFor(null, undefined)).toBe("unknown");
  });
});

describe("the shared-bucket fallback is loud", () => {
  /**
   * The finding: a loopback peer with no `X-Forwarded-For` collapsed the whole
   * estate into one counter **silently**. Driven through the route, three wrong
   * logins for one user plus three for another earned the sixth request a `429`
   * — and a correct login from an innocent third party got one too. One bucket,
   * everyone in it, with no log line, metric or assertion to explain it.
   *
   * It still fails closed into a shared bucket (a per-request bucket would
   * disable the lockout outright, which is worse). What changed is that it says
   * so.
   */
  it("warns when the peer is loopback and no forwarded address arrived", () => {
    const warn = vi.fn();

    expect(lockoutKeyFor("127.0.0.1", undefined, { warn })).toBe("127.0.0.1");

    expect(warn).toHaveBeenCalledTimes(1);
    const [detail, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(detail).toEqual({ peer: "127.0.0.1", bucket: "127.0.0.1" });
    // It has to name the consequence, not just the condition, or an operator
    // reading it at 2am cannot tell whether it matters.
    expect(message).toContain("X-Forwarded-For");
    expect(message).toContain("429");
  });

  it("warns when there is no peer at all", () => {
    const warn = vi.fn();

    expect(lockoutKeyFor(undefined, undefined, { warn })).toBe("unknown");

    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [Record<string, unknown>, string])[0]).toEqual({
      peer: null,
      bucket: "unknown",
    });
  });

  it("does not warn when an address was derived", () => {
    const warn = vi.fn();

    lockoutKeyFor("127.0.0.1", "203.0.113.9", { warn });
    lockoutKeyFor("203.0.113.9", undefined, { warn });

    expect(warn).not.toHaveBeenCalled();
  });

  it("rate-limits itself, so the warning cannot become the flood", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    resetLockoutWarningForTests();

    const warn = vi.fn();
    for (let i = 0; i < 100; i += 1) lockoutKeyFor("127.0.0.1", undefined, { warn });
    expect(warn).toHaveBeenCalledTimes(1);

    // Just short of the interval: still silent.
    vi.setSystemTime(
      new Date(Date.now() + (LOCKOUT_AMBIGUOUS_ADDRESS_WARN_INTERVAL_SECONDS - 1) * 1000),
    );
    lockoutKeyFor("127.0.0.1", undefined, { warn });
    expect(warn).toHaveBeenCalledTimes(1);

    // Past it: one more line, so a misconfiguration that is still there does
    // not disappear from the log forever.
    vi.setSystemTime(new Date(Date.now() + 2_000));
    lockoutKeyFor("127.0.0.1", undefined, { warn });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
