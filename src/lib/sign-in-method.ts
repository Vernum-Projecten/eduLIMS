// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// How a user signed in last: an identity provider, or the development login. Shared by the
// server (better-auth's last-login-method plugin) and the login page's hint.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.

/** The sign-in methods eduLIMS records, as `user.last_login_method` stores them. */
export const SIGN_IN_METHODS = ["microsoft", "keycloak", "credential"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/**
 * The browser cookie in which better-auth's last-login-method plugin remembers the method, for
 * the login page's "last time you signed in with" hint. It holds the method name only.
 */
export const LAST_SIGN_IN_METHOD_COOKIE = "EDULIMS_LAST_SIGN_IN_METHOD";

/** Returns `value` when it names a {@link SignInMethod}, else `null`. */
export function parseSignInMethod(value: unknown): SignInMethod | null {
  return SIGN_IN_METHODS.find((method) => method === value) ?? null;
}

/**
 * Returns the method in the hint cookie when the login page still offers it: a configured
 * identity provider, or the development login while it is on. Anything else gives no hint.
 */
export function offeredSignInMethod(
  cookie: string | undefined,
  providers: readonly SignInMethod[],
  devLogin: boolean,
): SignInMethod | null {
  const method = parseSignInMethod(cookie);
  if (method === null) return null;
  if (method === "credential") return devLogin ? method : null;
  return providers.includes(method) ? method : null;
}
