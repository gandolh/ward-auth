/**
 * `ward-auth-react.js` — the browser bundle: unstyled hooks over a small
 * client. React is a peer dependency and is never bundled; nothing here
 * imports the server bundle or any `node:` module.
 */

export {
  configureAuth,
  createAuthClient,
  getAuthClient,
  type ActionResult,
  type AuthClient,
  type AuthClientOptions,
  type AuthError,
  type AuthErrorCode,
  type SessionInfo,
  type SessionState,
  type SessionUser,
} from "./client.js";
export {
  useChangePassword,
  useLogin,
  useLogout,
  useRegister,
  useSession,
  type HookOptions,
} from "./hooks.js";
