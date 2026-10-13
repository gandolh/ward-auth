import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEXT,
  MAX_NEXT_LENGTH,
  loginUrlFor,
  resolveNext,
  type NextRejection,
} from "./next.js";

/**
 * The `?next=` allowlist, table-driven.
 *
 * This is the highest-value test in brief 09 and the table is meant to be
 * *added to* rather than admired: every string somebody thinks of that ought to
 * be refused belongs in the rejection table, and the cost of a new row is one
 * line. An open redirect here is a phishing primitive wearing Ward's own
 * certificate, so the bar is "we tried to break it and wrote down what we
 * tried", not "the happy path works".
 *
 * The `reason` is asserted as well as the refusal. Not because a caller reads
 * it — nothing renders it — but because a rule that stops catching what it was
 * written for should fail loudly rather than be covered by the rule after it.
 * A refusal that moves from `protocol_relative` to `unknown_root` is still a
 * refusal and is still a change worth seeing.
 */

const ACCEPTED: ReadonlyArray<{ input: string; path: string; why: string }> = [
  { input: "/ward/account", path: "/ward/account", why: "the account page's own sign-in link" },
  { input: "/ward", path: "/ward", why: "Ward's root with no trailing slash" },
  {
    input: "/ward/register?app=prm",
    path: "/ward/register?app=prm",
    why: "a deep link keeps its query string",
  },
  {
    input: "/ward/account#sessions",
    path: "/ward/account#sessions",
    why: "a fragment survives; it never leaves the browser anyway",
  },
  {
    input: "/ward/register?app=prm&from=mail",
    path: "/ward/register?app=prm&from=mail",
    why: "an ampersand is not a delimiter once the value is decoded",
  },
  { input: "/ward/a%20b", path: "/ward/a%20b", why: "an encoded space is fine; a raw one is not" },
  {
    input: "/ward/x/../account",
    path: "/ward/account",
    why: "traversal inside Ward collapses and stays inside it",
  },
  { input: "/ward/console", path: "/ward/console", why: "the console is one of Ward's pages" },
];

const REJECTED: ReadonlyArray<{ input: string | null | undefined; reason: NextRejection }> = [
  // ---- absent -------------------------------------------------------------
  { input: null, reason: "absent" },
  { input: undefined, reason: "absent" },
  { input: "", reason: "absent" },

  // ---- absolute URLs, the obvious attack ----------------------------------
  { input: "https://evil.example", reason: "not_absolute_path" },
  { input: "https://evil.example/ward/", reason: "not_absolute_path" },
  { input: "http://evil.example", reason: "not_absolute_path" },
  { input: "HTTPS://EVIL.EXAMPLE", reason: "not_absolute_path" },
  // The estate's own origin spelled absolutely is still refused: this UI has no
  // business knowing what the origin is, and accepting one absolute host is how
  // a later edit accepts two.
  { input: "https://gandolh.ro/ward/", reason: "not_absolute_path" },
  { input: "javascript:alert(1)", reason: "not_absolute_path" },
  { input: "data:text/html,<script>alert(1)</script>", reason: "not_absolute_path" },
  { input: "//evil.example", reason: "protocol_relative" },
  { input: "///evil.example", reason: "protocol_relative" },
  { input: "//evil.example/ward/", reason: "protocol_relative" },

  // ---- backslash tricks ---------------------------------------------------
  { input: "\\\\evil.example", reason: "backslash" },
  { input: "/\\evil.example", reason: "backslash" },
  { input: "/\\/evil.example", reason: "backslash" },
  { input: "\\/\\/evil.example", reason: "backslash" },
  { input: "/ward\\..\\..\\evil", reason: "backslash" },
  // Encoded, so the raw string is clean and the decoded one is not.
  { input: "/%5Cevil.example", reason: "backslash" },
  { input: "/%5c%5cevil.example", reason: "backslash" },
  // Double-encoded: `%255c` → `%5c` → `\`. Two passes.
  { input: "/%255Cevil.example", reason: "backslash" },

  // ---- whitespace and control characters ----------------------------------
  // A tab or newline is stripped by the URL parser, so `/\t/evil.example`
  // parses as `//evil.example` — the value means something different to the
  // parser than it does to a naive `startsWith("//")` check.
  { input: "/\t/evil.example", reason: "control_or_space" },
  { input: "/\n/evil.example", reason: "control_or_space" },
  { input: "/\r/evil.example", reason: "control_or_space" },
  { input: "\t//evil.example", reason: "control_or_space" },
  { input: " //evil.example", reason: "control_or_space" },
  { input: " /ward/", reason: "control_or_space" },
  { input: "/ward/ ", reason: "control_or_space" },
  { input: "/ward/\u0000", reason: "control_or_space" },
  { input: "/ward/\u007f", reason: "control_or_space" },
  { input: "/ward/\u00a0evil", reason: "control_or_space" },
  { input: "/\u2028/evil.example", reason: "control_or_space" },
  { input: "/\ufeff/evil.example", reason: "control_or_space" },
  // Encoded whitespace, which is the form that actually turns up in a link.
  { input: "/%09//evil.example", reason: "control_or_space" },
  { input: "/%0a//evil.example", reason: "control_or_space" },
  { input: "/%00", reason: "control_or_space" },

  // ---- encoded slashes ----------------------------------------------------
  { input: "%2f%2fevil.example", reason: "not_absolute_path" },
  { input: "/%2f%2fevil.example", reason: "protocol_relative" },
  { input: "/%2F/evil.example", reason: "protocol_relative" },
  // `%252f` → `%2f` → `/`, so the decoded fixed point is `///evil.example`.
  { input: "/%252f%252fevil.example", reason: "protocol_relative" },

  // ---- malformed encoding -------------------------------------------------
  { input: "/ward/%", reason: "undecodable" },
  { input: "/ward/%zz", reason: "undecodable" },
  { input: "/ward/%e0%a4%a", reason: "undecodable" },

  // ---- a path on this origin, but not one of Ward's pages ------------------
  // The apps' roots, which `next` named until the shared-cookie contract was
  // retired (brief 30). Apps now return through OpenID Connect, never `next`.
  { input: "/", reason: "outside_ward" },
  { input: "/atrium/", reason: "outside_ward" },
  { input: "/prm/map?lat=45.7&lng=21.2", reason: "outside_ward" },
  { input: "/ward/..", reason: "outside_ward" },
  { input: "/wardX/", reason: "outside_ward" },
  { input: "/Ward/account", reason: "outside_ward" },
  { input: "/evil", reason: "outside_ward" },
  { input: "/ward.evil.example/", reason: "outside_ward" },
  // Fullwidth Latin `w`. Renders like `ward` and is not `ward`.
  { input: "/ｗard/account", reason: "outside_ward" },
  { input: "/@evil.example", reason: "outside_ward" },
  // Traversal out of Ward, plain and percent-encoded. The encoded
  // form is the interesting one: the URL parser does not treat `%2e%2e` as a
  // dot segment, so only the decoded resolution catches it.
  { input: "/ward/../../evil", reason: "outside_ward" },
  { input: "/ward/%2e%2e/%2e%2e/evil", reason: "outside_ward" },
  { input: "/ward/../evil", reason: "outside_ward" },
  // The API root is deliberately not a page: nobody was reading an API
  // endpoint, so `?next=` never legitimately names one.
  { input: "/ward-api/session", reason: "outside_ward" },

  // ---- the loop -----------------------------------------------------------
  { input: "/ward/login", reason: "sign_in_loop" },
  { input: "/ward/login?next=/ward/account", reason: "sign_in_loop" },
  { input: "/ward/account/../login", reason: "sign_in_loop" },

  // ---- size ---------------------------------------------------------------
  { input: `/ward/${"a".repeat(MAX_NEXT_LENGTH)}`, reason: "too_long" },
];

describe("resolveNext", () => {
  describe("accepts a path inside Ward's own pages", () => {
    for (const row of ACCEPTED) {
      it(`${JSON.stringify(row.input)} — ${row.why}`, () => {
        const decision = resolveNext(row.input);
        expect(decision.accepted).toBe(true);
        expect(decision.path).toBe(row.path);
      });
    }
  });

  describe("refuses everything else, and lands on the default", () => {
    for (const row of REJECTED) {
      it(`${JSON.stringify(row.input)} → ${row.reason}`, () => {
        const decision = resolveNext(row.input);
        expect(decision.accepted).toBe(false);
        // The visible behaviour, and the only part a person experiences: their
        // account page, silently. No error, no diagnostic, no partial redirect.
        expect(decision.path).toBe(DEFAULT_NEXT);
        if (!decision.accepted) expect(decision.reason).toBe(row.reason);
      });
    }
  });

  it("never returns anything but the default for a refusal", () => {
    // A property rather than a case: `path` is safe to use unconditionally, so
    // a caller that forgets to check `accepted` still cannot be redirected off
    // the origin. That is the invariant the type encodes and this asserts.
    for (const row of REJECTED) {
      expect(resolveNext(row.input).path).toBe(DEFAULT_NEXT);
    }
  });

  it("is idempotent over its own output", () => {
    // Whatever an accepted value normalises to must itself be accepted, or a
    // caller that round-trips the value through a URL loses the redirect.
    for (const row of ACCEPTED) {
      const once = resolveNext(row.input);
      expect(once.accepted).toBe(true);
      const twice = resolveNext(once.path);
      expect(twice.accepted).toBe(true);
      expect(twice.path).toBe(once.path);
    }
  });

  it("accepts a value of exactly the maximum length", () => {
    const filler = "a".repeat(MAX_NEXT_LENGTH - "/ward/".length);
    const value = `/ward/${filler}`;
    expect(value.length).toBe(MAX_NEXT_LENGTH);
    expect(resolveNext(value).accepted).toBe(true);
  });
});

describe("loginUrlFor", () => {
  it("encodes the destination so a query string survives", () => {
    // The mistake this exists to prevent: an unencoded `&` truncates `next` at
    // the first parameter, and the person lands somewhere other than the
    // thing they clicked.
    const url = loginUrlFor("/ward/register?app=prm&from=mail");
    expect(url).toBe("/ward/login?next=%2Fward%2Fregister%3Fapp%3Dprm%26from%3Dmail");
    const round = new URL(url, "https://ward.invalid").searchParams.get("next");
    expect(resolveNext(round)).toMatchObject({
      accepted: true,
      path: "/ward/register?app=prm&from=mail",
    });
  });
});
