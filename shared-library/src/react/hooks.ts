import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  getAuthClient,
  type ActionResult,
  type AuthClient,
  type AuthError,
  type SessionState,
} from "./client.js";

/**
 * Unstyled React hooks over the auth client. They return state and handlers
 * and render nothing, so every app keeps its own login, register and settings
 * pages in its own design.
 *
 * All five read one shared session state (an external store, not a context),
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
