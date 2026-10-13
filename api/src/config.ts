import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { parseTrustedProxies, type TrustedProxies } from "./auth/lockout.js";

/**
 * Ward's runtime configuration: resolved from the environment once, validated
 * at import time, and exported as plain constants.
 *
 * Every variable is REQUIRED and nothing falls back to a working-but-wrong
 * value. That rule is inherited from atrium's D29, which exists because an app
 * in this estate booted happily with an empty library and never told anyone —
 * a service that starts misconfigured is worse than one that refuses to start,
 * because the failure surfaces days later as "where did my books go" instead
 * of immediately as a line on stderr. `HOST` is the single variable with a
 * default, and it defaults in the *safe* direction (see below), so an absent
 * value cannot widen Ward's exposure.
 *
 * Importing this module can terminate the process. That is deliberate: the
 * check has to happen before anything opens a socket or a database handle, and
 * an import is the only hook that is guaranteed to run first. Keep this module
 * dependency-free apart from zod — anything it imports would run before the
 * environment has been validated. The one exception is `parseTrustedProxies`
 * from `auth/lockout.ts`, which imports nothing but `node:net` and does
 * nothing at import time; it is imported so that `WARD_TRUSTED_PROXIES` is
 * read by the same parser that later matches against it.
 *
 * The .env contract, including which module reads each variable, is documented
 * in `.env.example` at the repo root.
 */

/**
 * Anchor every path to this source file rather than `process.cwd()`. Under
 * `tsx` in development this file is `api/src/config.ts`; in production pm2
 * runs the build at `api/dist/config.js` — both sit one level below `api/`, so
 * the same two `resolve` calls land on the same directories either way. cwd
 * would not: pm2 sets it to whatever the ecosystem file says, and an operator
 * running a script from a subdirectory would silently get different paths.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // api/src (dev) or api/dist (built)
const API_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(API_ROOT, "..");

/**
 * Load the single repo-root `.env` into process.env before validating.
 *
 * `process.loadEnvFile` is the Node ≥21 builtin — dotenv would be a dependency
 * that buys nothing here. Best-effort on purpose: in production the variables
 * come from pm2's environment rather than a file on disk, so a missing `.env`
 * is a normal state and not an error. The schema below is the real gate; this
 * is only a convenience for development.
 */
const ENV_FILE = resolve(REPO_ROOT, ".env");
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

/**
 * `.min(1)` on every string is not decoration: an unset variable and
 * `WARD_ADMIN_PASSWORD=` are the same mistake, and only the length check
 * catches the second one. Without it, an empty admin password would parse
 * cleanly and Ward would boot with a credential that anyone can guess by
 * submitting nothing.
 */
/**
 * An absolute http(s) URL that may carry a path but no query or fragment.
 * Trailing slashes are stripped for the same reason `WARD_PUBLIC_ORIGIN`'s
 * are: the value is compared as an exact string (`iss`), and a stray slash is
 * a typo, not a misunderstanding.
 */
const externalUrl = z
  .string()
  .min(1)
  .transform((value) => value.trim().replace(/\/+$/, ""))
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.search === "" &&
        url.hash === "" &&
        url.href.replace(/\/+$/, "") === value
      );
    },
    {
      message:
        'must be an absolute http(s) URL, lowercase host, with no query, fragment or trailing slash (e.g. "https://example.com/ward-api/oidc")',
    },
  );

const envSchema = z.object({
  /** Loopback port Caddy reverse-proxies `/ward-api/*` to. */
  PORT: z.coerce.number().int().positive().max(65_535),

  /**
   * Defaults to loopback, and this is the one deliberate default in the file.
   *
   * Atrium binds `0.0.0.0` and its "Caddy is the only way in" assumption
   * therefore rests entirely on the VPS firewall — one `ufw` rule away from
   * the identity service for six apps being reachable from the internet
   * directly, bypassing every header and rate limit Caddy applies. Ward does
   * not repeat that: the kernel refuses off-host connections whether or not
   * the firewall is configured, so the two controls have to fail together
   * rather than one of them being load-bearing alone.
   *
   * Still overridable, because a container needs `0.0.0.0` to be reachable at
   * all — but that has to be an explicit, visible act in the `.env`, not the
   * behaviour you get by forgetting to set anything.
   */
  HOST: z.string().min(1).default("127.0.0.1"),

  /**
   * Peers, beyond loopback, whose `X-Forwarded-For` the login lockout believes:
   * comma-separated addresses or CIDR ranges, IPv4 or IPv6. Optional, and
   * unset means loopback only — the safe direction, like `HOST`, because a
   * range listed here can choose its own lockout bucket by sending the header.
   *
   * It exists because Ward runs in a container (brief 28). Host Caddy reaches
   * it through Docker's proxy, so the socket peer is a bridge address, never
   * loopback, and with nothing listed every request in the estate keyed on
   * that one address: five bad passwords from anyone locked everyone out.
   * Set it to the network the proxy reaches Ward from — Docker's default
   * `172.16.0.0/12` in production unless the stack pins a subnet.
   *
   * Parsed here so a malformed entry stops the boot naming the entry, rather
   * than surfacing as a `500` on every login. See `lockoutKeyFor`.
   */
  WARD_TRUSTED_PROXIES: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseTrustedProxies(value ?? "");
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /** better-sqlite3 database file. Relative values resolve against the repo root. */
  WARD_DB_PATH: z.string().min(1),

  /**
   * The break-glass superuser (decisions-admin.md). Environment-only, with no
   * row in any table — which is exactly why it belongs in this file and not in
   * a seed script: it is configuration, and it is the only credential that
   * still works when the database is empty, corrupted, or has had its last
   * admin removed.
   */
  WARD_ADMIN_USERNAME: z.string().min(1),
  WARD_ADMIN_PASSWORD: z.string().min(1),

  /** Ed25519 private key Ward alone holds. Relative values resolve against the repo root. */
  WARD_SIGNING_KEY_PATH: z.string().min(1),

  /**
   * The estate's single public origin. Validated as a *bare* origin —
   * scheme + host + optional port, nothing else — for two reasons.
   *
   * First, it becomes the `iss` claim on every access token (brief 02), and
   * `iss` is compared as an exact string by six verifiers. Ward minting
   * `https://gandolh.ro/` while an app expects `https://gandolh.ro` rejects
   * every token in the estate, with a mismatch that reads as "auth is broken"
   * rather than as a stray character. Trailing slashes are therefore stripped
   * before validation rather than rejected, since that one is a typo, not a
   * misunderstanding.
   *
   * Second, the name means what the glossary says it means: the browser's
   * origin, the thing that decides cookie scope. Someone setting the API base
   * URL (`https://gandolh.ro/ward-api`) here would produce tokens whose `iss`
   * looks plausible and cookies scoped to the wrong place — so a value
   * carrying a path is refused outright instead of being quietly trimmed to
   * its origin, because trimming would hide a genuine misunderstanding of
   * which URL was being asked for.
   */
  /**
   * How Ward sends verification mail: `smtp` or `file`.
   *
   * **Explicit, required, and deliberately not inferred from `NODE_ENV`.**
   * Brief 07's acceptance says development must not need SMTP credentials, and
   * the obvious way to grant that — sniff the environment and fall back to
   * writing files — is the shape this whole file exists to refuse. An estate
   * whose mail silently stopped leaving the building because a variable was
   * unset somewhere is a registration flow that appears to work and delivers
   * nothing.
   *
   * So the mode is stated, and each mode requires its own settings below. A
   * misconfigured Ward fails at boot naming the variable, rather than at the
   * moment somebody was waiting for a verification link.
   */
  WARD_MAIL_TRANSPORT: z.enum(["smtp", "file"]),

  /**
   * Where `file` transport writes messages. Required only in that mode.
   * Relative values resolve against the repo root, and the directory is
   * gitignored — a verification mail holds a single-use token.
   */
  WARD_MAIL_FILE_DIR: z.string().min(1).optional(),

  /** SMTP settings. Required only in `smtp` mode; see the refinement below. */
  WARD_SMTP_HOST: z.string().min(1).optional(),
  WARD_SMTP_PORT: z.coerce.number().int().positive().max(65_535).optional(),
  WARD_SMTP_USER: z.string().min(1).optional(),
  WARD_SMTP_PASSWORD: z.string().min(1).optional(),

  /**
   * The `From:` address. Required in both modes — a message written to disk
   * still has to look like the one that would have been sent, or the `file`
   * transport stops being a rehearsal of the real thing.
   */
  WARD_MAIL_FROM: z.string().min(1),

  /**
   * The OpenID Connect issuer (brief 18), as the **browser** sees it — e.g.
   * `https://example.com/ward-api/oidc`. Optional, and absent means the provider
   * is not mounted at all: every route that existed before brief 18 behaves as
   * it did, so a deploy that has not set it yet keeps the estate signing in.
   * That is the safe direction, the same reasoning as `HOST` above, and unlike a
   * derived default it cannot be wrong.
   *
   * It must end in `/oidc`, Ward's internal mount, and everything before that
   * is the prefix the proxy strips (`/ward-api` behind Caddy, nothing when the
   * browser talks to Ward directly). That rule is what lets the provider emit
   * this URL rather than the internal one in discovery, in `iss` and in every
   * endpoint it advertises — the `/ward-api` bug class integrating.md rule 2
   * records. `oidc/layout.ts` does the split.
   */
  WARD_OIDC_ISSUER: externalUrl.optional(),

  /**
   * Ward's own UI, absolute — e.g. `https://example.com/ward`. Required when the
   * issuer is set, and must share its origin: the provider sends a person who is
   * not signed in to `<this>/login`, and the cookies that sign-in sets have to be
   * readable by the issuer's interaction route. A setting rather than a constant
   * because decisions-oidc.md makes Ward's UI base path configuration, so the
   * day Ward moves to a subdomain is an env change here.
   */
  WARD_UI_URL: externalUrl.optional(),

  WARD_PUBLIC_ORIGIN: z
    .string()
    .min(1)
    .transform((value) => value.trim().replace(/\/+$/, ""))
    .refine(
      (value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return false;
        }
        return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
      },
      {
        message:
          'must be a bare origin — scheme://host[:port], lowercase, with no path, query or fragment (e.g. "https://gandolh.ro")',
      },
    ),
});

/**
 * The mode-dependent half of the contract.
 *
 * `zod` can express "required" and "optional" per field, but not "required
 * *because* another field says so", so the cross-field rule lives here. It
 * still runs before anything boots, and it still names the missing variable —
 * which is the property that matters, not where the check happens to sit.
 */
const mailAwareSchema = envSchema.superRefine((env, ctx) => {
  // The OIDC pair: the UI URL is needed exactly when the issuer is set, and the
  // two must share an origin (see `WARD_UI_URL`). The `/oidc` suffix is checked
  // here rather than in the field so the message can name the rule.
  if (env.WARD_OIDC_ISSUER !== undefined) {
    if (!new URL(env.WARD_OIDC_ISSUER).pathname.endsWith("/oidc")) {
      ctx.addIssue({
        code: "custom",
        path: ["WARD_OIDC_ISSUER"],
        message:
          'must end in "/oidc", Ward\'s internal mount; the part before it is the prefix the proxy strips (e.g. "https://example.com/ward-api/oidc")',
      });
    }
    if (env.WARD_UI_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["WARD_UI_URL"],
        message: "is required when WARD_OIDC_ISSUER is set",
      });
    } else if (new URL(env.WARD_UI_URL).origin !== new URL(env.WARD_OIDC_ISSUER).origin) {
      ctx.addIssue({
        code: "custom",
        path: ["WARD_UI_URL"],
        message: "must be on the same origin as WARD_OIDC_ISSUER",
      });
    }
  }

  if (env.WARD_MAIL_TRANSPORT === "smtp") {
    for (const key of [
      "WARD_SMTP_HOST",
      "WARD_SMTP_PORT",
      "WARD_SMTP_USER",
      "WARD_SMTP_PASSWORD",
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: 'is required when WARD_MAIL_TRANSPORT is "smtp"',
        });
      }
    }
  } else if (env.WARD_MAIL_FILE_DIR === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["WARD_MAIL_FILE_DIR"],
      message: 'is required when WARD_MAIL_TRANSPORT is "file"',
    });
  }
});

const parsed = mailAwareSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`,
  );
  /**
   * Fail fast and loudly. Written straight to stderr because the Fastify
   * logger does not exist yet, and boxed because this message is read at 2am
   * through a pm2 log tail where it has to be findable among restart noise.
   * Each line names the offending variable — an operator should not have to
   * diff `.env` against `.env.example` to learn which one is wrong.
   */
  console.error(
    "\n============================================================\n" +
      "  Ward: invalid or missing environment configuration.\n" +
      "  Set these variables (copy .env.example to .env) and retry:\n\n" +
      lines.join("\n") +
      "\n============================================================\n",
  );
  process.exit(1);
}

const env = parsed.data;

/** Read by `api/src/index.ts` to bind the Fastify listener. */
export const PORT: number = env.PORT;
export const HOST: string = env.HOST;

/**
 * Read by every route that derives a lockout key — `/login`, `/refresh`,
 * `/console/login`, `/register` and `/account/password` — so they all agree on
 * what a client address is. Empty means loopback only.
 */
export const WARD_TRUSTED_PROXIES: TrustedProxies = env.WARD_TRUSTED_PROXIES;

/**
 * Both file paths are resolved against the repo root rather than left as
 * given, so that everything downstream — better-sqlite3, the key loader, log
 * lines, error messages — deals in one unambiguous absolute path. A relative
 * `WARD_DB_PATH` that resolved against cwd would mean pm2 and a hand-run
 * script open two different database files while both look correct.
 */
/** Read today by `api/src/db/connection.ts` — `getDb()` opens the database at this path. */
export const WARD_DB_PATH: string = resolve(REPO_ROOT, env.WARD_DB_PATH);
/** Not read yet — reserved for `api/src/tokens/`, which brief 02 has not written. */
export const WARD_SIGNING_KEY_PATH: string = resolve(REPO_ROOT, env.WARD_SIGNING_KEY_PATH);

/**
 * Read by the console session code (brief 06). Note what these are NOT: they
 * are not an account, and nothing in this process should look them up, mirror
 * them into a table, or grant them anything. "Console only" falls out of the
 * superuser having no grants, not out of a check somewhere.
 */
export const WARD_ADMIN_USERNAME: string = env.WARD_ADMIN_USERNAME;
export const WARD_ADMIN_PASSWORD: string = env.WARD_ADMIN_PASSWORD;

/** Not read yet — reserved for token minting (brief 02), which will use it as the `iss` claim. */
export const WARD_PUBLIC_ORIGIN: string = env.WARD_PUBLIC_ORIGIN;

/**
 * Mail configuration (brief 07 — public registration).
 *
 * Exported as a discriminated union rather than seven loose strings, so the
 * sender cannot be written against a shape the environment did not actually
 * produce. In `file` mode there is no SMTP password to leak into a log; in
 * `smtp` mode the directory does not exist to be written to. The refinement
 * above is what makes the narrowing sound.
 */
export type MailTransport =
  | { kind: "file"; dir: string; from: string }
  | { kind: "smtp"; host: string; port: number; user: string; password: string; from: string };

export const MAIL: MailTransport =
  env.WARD_MAIL_TRANSPORT === "file"
    ? {
        kind: "file",
        // Non-null: the refinement rejected a `file` transport without it.
        dir: resolve(REPO_ROOT, env.WARD_MAIL_FILE_DIR!),
        from: env.WARD_MAIL_FROM,
      }
    : {
        kind: "smtp",
        host: env.WARD_SMTP_HOST!,
        port: env.WARD_SMTP_PORT!,
        user: env.WARD_SMTP_USER!,
        password: env.WARD_SMTP_PASSWORD!,
        from: env.WARD_MAIL_FROM,
      };

/**
 * OpenID Connect provider settings (brief 18), or `undefined` when
 * `WARD_OIDC_ISSUER` is unset and the provider is not mounted. Read by
 * `oidc/routes.ts`. The refinement above guarantees `uiUrl` whenever there is
 * an issuer.
 */
export interface OidcSettings {
  issuer: string;
  uiUrl: string;
}

export const OIDC: OidcSettings | undefined =
  env.WARD_OIDC_ISSUER === undefined
    ? undefined
    : { issuer: env.WARD_OIDC_ISSUER, uiUrl: env.WARD_UI_URL! };
