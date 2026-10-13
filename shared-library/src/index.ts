/**
 * `ward-auth.js` — the server bundle.
 *
 * Local accounts, sessions and lockout for an app in the estate, "Sign in
 * with Ward" (OpenID Connect against Ward, through the bundled
 * `openid-client`), plus the Fastify plugin. Framework-free core first, then
 * the plugin; nothing here imports React, and Fastify is imported for types
 * only, so the bundle has no runtime import other than `node:` built-ins.
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
  parseTrustedProxies,
  type Lockout,
  type LockoutDecision,
  type LockoutKeyOptions,
  type LockoutOptions,
  type LockoutSurface,
  type LockoutTarget,
  type TrustedProxies,
  type TrustedProxyRange,
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
  AlreadyLinkedError,
  UserIdTakenError,
  UsernameTakenError,
  WardSubjectTakenError,
  isWardAuthStore,
  type AuthStore,
  type Awaitable,
  type NewUserRecord,
  type SessionOrigin,
  type SessionRecord,
  type UserRecord,
  type WardAuthStore,
  type WardLinkRecord,
} from "./store/types.js";
export {
  DEFAULT_NOTIFY_TIMEOUT_MS,
  DEFAULT_WARD_TIMEOUT_MS,
  SESSION_STATUS_CACHE_SECONDS,
  createWardClient,
  wardClientOptionsFromEnv,
  type WardClient,
  type WardClientOptions,
  type WardFlowSecrets,
  type WardIdentity,
  type WardNotification,
  type WardSessionStatus,
} from "./ward/client.js";
export { WardConfigurationError, WardSignInError, WardUnavailableError } from "./ward/errors.js";
export {
  NoLocalPasswordError,
  NotLinkedError,
  createWardIdentities,
  type NewLinkedUserInput,
  type WardIdentities,
  type WardIdentitiesOptions,
} from "./ward/identities.js";
export { InvalidClientKeyError } from "./ward/key.js";
export {
  requireRole,
  wardAuth,
  type AuthContext,
  type SessionValidator,
  type SessionVerdict,
  type WardAuthOptions,
} from "./fastify/plugin.js";
export { FRESH_SIGN_IN_SECONDS, type WardSignInOptions } from "./fastify/ward.js";
