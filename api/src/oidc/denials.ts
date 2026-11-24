/**
 * Ward's `api/src/oidc/denials.ts`: why Ward's login step refused a sign-in,
 * and the `error_description` the app gets beside `error=access_denied` for
 * each (`interaction.ts`).
 *
 * **These words are wire contract.** The shared library tells a cancel from a
 * refusal by comparing the description with `DENIAL_DESCRIPTIONS.cancelled`,
 * which its build copies from this file into the server bundle, so every
 * vendored copy holds the words of the day it was built. Changing them sends
 * a cancel to those copies as `access_denied` until each app re-vendors.
 *
 * The file imports nothing, so the library's build can read it.
 */

export type Denial = "account_disabled" | "no_grant" | "cancelled";

export const DENIAL_DESCRIPTIONS: Readonly<Record<Denial, string>> = {
  account_disabled: "the account is disabled",
  no_grant: "the account holds no grant for this app",
  cancelled: "the person cancelled the sign-in",
};
