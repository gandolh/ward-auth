/**
 * The one rule for a path the library sends a browser to: the configured
 * pages, `returnTo`, and since 0.7.0 the `ward_return_to` a refused sign-in
 * carries back. Framework-free, so the browser bundle checks a path from the
 * address bar with the same rule the server checked it with.
 */

/**
 * A path on the app's own origin: starts with one `/`, no `//` or `/\`
 * (which browsers read as another host), no control characters, short.
 * What `returnTo` and the configured pages must be — never an open redirect.
 */
export function isLocalPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !value.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
