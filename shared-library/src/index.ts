/**
 * `ward-auth.js` — the server bundle.
 *
 * Local accounts, sessions and lockout for an app in the estate, plus the
 * Fastify plugin. Framework-free core first, then the plugin; nothing here
 * imports React, and Fastify is imported for types only, so the bundle has no
 * runtime import other than `node:` built-ins.
 */

export {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  SESSION_RENEW_INTERVAL_SECONDS,
  InvalidUserIdError,
  createAccounts,
  seedUsers,
  toAuthUser,
  type Accounts,
  type AccountsOptions,
  type AuthUser,
  type NewUserInput,
  type ResolvedSession,
  type SeedResult,
  type SeedUser,
  type StartSessionOptions,
} from "./core/accounts.js";
export {
  clearedCookie,
  readCookie,
  secureCookiesFor,
  serializeCookie,
  type CookieOptions,
} from "./core/cookie.js";
export {
  MAX_USERNAME_LENGTH,
  UsernamePolicyError,
  foldUsername,
  generateSessionToken,
  hashSessionToken,
  normaliseUsername,
} from "./core/identifiers.js";
export {
  LOCKOUT_MAX_FAILURES,
  LOCKOUT_WINDOW_SECONDS,
  createLockout,
  lockoutKeyFor,
  type Lockout,
  type LockoutDecision,
  type LockoutKeyOptions,
  type LockoutOptions,
  type LockoutSurface,
  type LockoutTarget,
} from "./core/lockout.js";
export {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  hashPassword,
  spendDummyHash,
  verifyPassword,
} from "./core/password.js";
export { SQLITE_MIGRATIONS, type Migration } from "./store/migrations.js";
export {
  SchemaTooNewError,
  createSqliteStore,
  migrateSqlite,
  type SqlValue,
  type SqliteAuthStore,
  type SqliteHandle,
  type SqliteStatement,
  type SqliteStoreOptions,
  type SyncStore,
} from "./store/sqlite.js";
export {
  UserIdTakenError,
  UsernameTakenError,
  type AuthStore,
  type Awaitable,
  type NewUserRecord,
  type SessionOrigin,
  type SessionRecord,
  type UserRecord,
} from "./store/types.js";
export {
  requireRole,
  wardAuth,
  type AuthContext,
  type SessionValidator,
  type SessionVerdict,
  type WardAuthOptions,
} from "./fastify/plugin.js";
