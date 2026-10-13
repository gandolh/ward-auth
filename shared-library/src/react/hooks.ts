import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  getAuthClient,
  type ActionResult,
  type AuthClient,
  type AuthError,
  type SessionState,
  type WardResult,
} from "./client.js";

/**
 * Unstyled React hooks over the auth client. They return state and handlers
 * and render nothing, so every app keeps its own login, register and settings
 * pages in its own design.
 *
 * They all read one shared session state (an external store, not a context),
 * so a successful `login` from a form flips every `useSession` on the page to
 * signed in without a provider or a reload.
 *
 * Each takes an optional `{ client }`; without one they use the client
 * `configureAuth` set up.
 */

export interface HookOptions {
  client?: AuthClient;
}

function useClient(options: HookOptions | undefined): AuthClient {
  return options?.client ?? getAuthClient();
}

/** The session, loaded on first use, plus a way to ask again. */
export function useSession(options?: HookOptions): SessionState & { refresh: () => Promise<void> } {
  const client = useClient(options);
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);

  useEffect(() => {
    client.ensureLoaded();
  }, [client]);

  const refresh = useCallback(async () => {
    await client.refresh();
  }, [client]);

  return { ...state, refresh };
}

/** The shared shape of a one-shot action: pending, the last error, and a reset. */
interface ActionState {
  pending: boolean;
  error: AuthError | null;
  reset: () => void;
}

function useAction<Args extends unknown[]>(
  run: (...args: Args) => Promise<ActionResult>,
): ActionState & { perform: (...args: Args) => Promise<boolean> } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const perform = useCallback(
    async (...args: Args) => {
      setPending(true);
      setError(null);
      try {
        const result = await run(...args);
        if (!result.ok) setError(result.error);
        return result.ok;
      } finally {
        setPending(false);
      }
    },
    [run],
  );

  const reset = useCallback(() => setError(null), []);
  return { pending, error, reset, perform };
}

/**
 * `login(username, password)` resolves `true` on success, when the session
 * state is already signed in. On failure `error.code` is `invalid_credentials`,
 * `too_many_attempts` (with `retryAfterSeconds`), `invalid_request` or
 * `network`; the app writes the message.
 */
export function useLogin(
  options?: HookOptions,
): ActionState & { login: (username: string, password: string) => Promise<boolean> } {
  const client = useClient(options);
  const run = useCallback(
    (username: string, password: string) => client.login(username, password),
    [client],
  );
  const { perform, ...state } = useAction(run);
  return { ...state, login: perform };
}

/** `logout()` ends the session here; the state becomes signed out. */
export function useLogout(options?: HookOptions): ActionState & { logout: () => Promise<boolean> } {
  const client = useClient(options);
  const run = useCallback(() => client.logout(), [client]);
  const { perform, ...state } = useAction(run);
  return { ...state, logout: perform };
}

/**
 * `changePassword(current, next)`. On success every *other* session the user
 * holds has ended and `done` is true. Errors: `invalid_credentials` (wrong
 * current password), `password_too_short`, `password_too_long`,
 * `too_many_attempts`, `unauthorized`.
 */
export function useChangePassword(options?: HookOptions): ActionState & {
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  done: boolean;
} {
  const client = useClient(options);
  const [done, setDone] = useState(false);
  const run = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setDone(false);
      const result = await client.changePassword(currentPassword, newPassword);
      if (result.ok) setDone(true);
      return result;
    },
    [client],
  );
  const { perform, ...state } = useAction(run);
  return { ...state, changePassword: perform, done };
}

/**
 * `register(username, password)`, for the app that enables registration.
 * Signs the new user in on success. Errors: `username_taken`,
 * `invalid_username`, `password_too_short`, `password_too_long`,
 * `too_many_attempts`.
 */
export function useRegister(
  options?: HookOptions,
): ActionState & { register: (username: string, password: string) => Promise<boolean> } {
  const client = useClient(options);
  const run = useCallback(
    (username: string, password: string) => client.register(username, password),
    [client],
  );
  const { perform, ...state } = useAction(run);
  return { ...state, register: perform };
}

// ---------------------------------------------------------------------------
// Sign in with Ward
// ---------------------------------------------------------------------------

/** The Ward result the page was loaded with (`?ward_error=` / `?ward=`), and a way to dismiss it. */
export function useWardResult(options?: HookOptions): WardResult & { clear: () => void } {
  const client = useClient(options);
  const result = useSyncExternalStore(client.subscribe, client.getWardResult, client.getWardResult);
  const clear = useCallback(() => client.clearWardResult(), [client]);
  return { ...result, clear };
}

/**
 * The login page's "Sign in with Ward" button. `signIn()` (optionally with a
 * `returnTo` path) sends the browser to Ward; it only resolves `false`, with
 * `error` set, when it could not get there — `ward_unavailable`,
 * `ward_misconfigured`, `network`.
 *
 * When Ward sends the person back with a failure, the page loads with
 * `?ward_error=<code>` and `error` starts as that: `access_denied` (no grant,
 * a disabled account, or they pressed "Back to the app"), `invalid_callback`,
 * `ward_unavailable`. `reset()` dismisses it. Show the button only when
 * `useSession().ward.enabled`.
 */
export function useWardSignIn(options?: HookOptions): ActionState & {
  signIn: (signInOptions?: { returnTo?: string }) => Promise<boolean>;
} {
  const client = useClient(options);
  const landed = useWardResult(options);
  const run = useCallback(
    (signInOptions?: { returnTo?: string }) => client.startWardSignIn(signInOptions),
    [client],
  );
  const { perform, error, reset, pending } = useAction(run);
  const { clear } = landed;
  const resetAll = useCallback(() => {
    reset();
    clear();
  }, [reset, clear]);
  return { pending, error: error ?? landed.error ?? null, reset: resetAll, signIn: perform };
}

/**
 * Settings: "Link Ward". `link()` sends the browser to Ward; the settings
 * page then loads with `linked` true, or with `error` set to
 * `already_linked`, `ward_account_in_use`, `access_denied`,
 * `invalid_callback` or `unauthorized` (the session that started the link
 * had ended). Show it when `useSession().ward.enabled && !ward.linked`.
 */
export function useWardLink(options?: HookOptions): ActionState & {
  link: () => Promise<boolean>;
  linked: boolean;
} {
  const client = useClient(options);
  const landed = useWardResult(options);
  const run = useCallback(() => client.startWardLink(), [client]);
  const { perform, error, reset, pending } = useAction(run);
  const { clear } = landed;
  const resetAll = useCallback(() => {
    reset();
    clear();
  }, [reset, clear]);
  return {
    pending,
    error: error ?? landed.error ?? null,
    reset: resetAll,
    link: perform,
    linked: landed.result === "linked",
  };
}

/**
 * Settings: "Unlink Ward". Refused with `no_local_password` while the user
 * has none (offer `useSetLocalPassword` first), `not_linked` when there is
 * nothing to unlink. If the current session began with Ward it ends too, and
 * the session state becomes signed out.
 */
export function useWardUnlink(options?: HookOptions): ActionState & {
  unlink: () => Promise<boolean>;
  done: boolean;
} {
  const client = useClient(options);
  const [done, setDone] = useState(false);
  const run = useCallback(async () => {
    setDone(false);
    const result = await client.unlinkWard();
    if (result.ok) setDone(true);
    return result;
  }, [client]);
  const { perform, ...state } = useAction(run);
  return { ...state, unlink: perform, done };
}

/**
 * Settings: "Set a local password", so a user created from Ward can still
 * get in while Ward is down. For a user who has a password,
 * `setPassword(next, current)` (a password change). For one who has none,
 * `setPassword(next)` works within ten minutes of a Ward sign-in; after that
 * it fails with `reauthentication_required` — call `reauthenticate()`, which
 * sends the person through Ward (asking for their Ward password) and back to
 * settings with `reauthenticated` true. Other errors: `invalid_credentials`,
 * `password_too_short`, `password_too_long`, `too_many_attempts`.
 */
export function useSetLocalPassword(options?: HookOptions): ActionState & {
  setPassword: (newPassword: string, currentPassword?: string) => Promise<boolean>;
  reauthenticate: () => Promise<boolean>;
  reauthenticated: boolean;
  done: boolean;
} {
  const client = useClient(options);
  const landed = useWardResult(options);
  const [done, setDone] = useState(false);
  const run = useCallback(
    async (newPassword: string, currentPassword?: string) => {
      setDone(false);
      const result = await client.setLocalPassword(newPassword, currentPassword);
      if (result.ok) setDone(true);
      return result;
    },
    [client],
  );
  const { perform, ...state } = useAction(run);
  const reauthenticateRun = useCallback(() => client.startWardReauthentication(), [client]);
  const reauth = useAction(reauthenticateRun);
  return {
    ...state,
    pending: state.pending || reauth.pending,
    error: state.error ?? reauth.error,
    setPassword: perform,
    reauthenticate: reauth.perform,
    reauthenticated: landed.result === "reauthenticated",
    done,
  };
}

/**
 * "Sign out of Ward too": ends the session here, then sends the browser to
 * Ward, which ends the Ward session this one began with and comes back to
 * the app's registered sign-out page. For a session that did not begin with
 * Ward it is a plain sign-out. Error: `ward_unavailable` (nothing was ended;
 * offer the ordinary `useLogout`).
 */
export function useWardSignOut(options?: HookOptions): ActionState & {
  signOut: () => Promise<boolean>;
} {
  const client = useClient(options);
  const run = useCallback(() => client.signOutOfWard(), [client]);
  const { perform, ...state } = useAction(run);
  return { ...state, signOut: perform };
}
