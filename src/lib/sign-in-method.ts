// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// How a user signed in last: an identity provider (its provider id, ADR 0015), or the
// development login. Shared by the server (better-auth's last-login-method plugin) and the
// login page's hint. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { type ProviderId, parseProviderId } from "./identity-providers.ts";

/** The sign-in method of the development login. */
export const CREDENTIAL_SIGN_IN = "credential";

/** A sign-in method as `user.last_login_method` stores it. */
export type SignInMethod = typeof CREDENTIAL_SIGN_IN | ProviderId;

/**
 * The browser cookie in which better-auth's last-login-method plugin remembers the method, for
 * the login page's "last time you signed in with" hint. It holds the method name only.
 */
export const LAST_SIGN_IN_METHOD_COOKIE = "EDULIMS_LAST_SIGN_IN_METHOD";

/** Returns `value` when it names a {@link SignInMethod}, else `null`. */
export function parseSignInMethod(value: unknown): SignInMethod | null {
  if (value === CREDENTIAL_SIGN_IN) return CREDENTIAL_SIGN_IN;
  return parseProviderId(value);
}

/**
 * Returns the method in the hint cookie when the login page still offers it: an enabled
 * identity provider, or the development login while it is on. Anything else gives no hint.
 */
export function offeredSignInMethod(
  cookie: string | undefined,
  providers: readonly ProviderId[],
  devLogin: boolean,
): SignInMethod | null {
  const method = parseSignInMethod(cookie);
  if (method === null) return null;
  if (method === CREDENTIAL_SIGN_IN) return devLogin ? method : null;
  return providers.includes(method) ? method : null;
}
