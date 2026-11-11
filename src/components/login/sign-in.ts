// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import {
  ACCOUNT_DEPROVISIONED_ERROR,
  ACCOUNT_NOT_LINKED_ERROR,
  NO_ROLE_ERROR,
  normalizeSignInError,
  PROVIDER_DISABLED_ERROR,
  type ProviderId,
  ROLE_CONFLICT_ERROR,
  SAML_NAMEID_ERROR,
} from "@/lib/identity-providers";

/** better-auth's error code for a sign-in of a blocked user (admin plugin, 1.7.20). */
export const BLOCKED_ERROR = "BANNED_USER";

/**
 * Returns the translated message for a sign-in error code on `/login`. Every other code (the
 * plugin's `invalid_state`, `invalid_provider`, `discovery_failed`, a replayed assertion) gets
 * one generic message; the details are in the server log only.
 */
export function loginErrorMessage(error: string): string {
  if (error === BLOCKED_ERROR) return m.login_error_blocked();
  const code = normalizeSignInError(error);
  if (code === NO_ROLE_ERROR) return m.login_error_no_role();
  if (code === ROLE_CONFLICT_ERROR) return m.login_error_role_conflict();
  if (code === ACCOUNT_NOT_LINKED_ERROR) return m.login_error_account_not_linked();
  if (code === PROVIDER_DISABLED_ERROR) return m.login_error_provider_disabled();
  if (code === SAML_NAMEID_ERROR) return m.login_error_saml_nameid();
  if (code === ACCOUNT_DEPROVISIONED_ERROR) return m.login_error_deprovisioned();
  if (code === "banned_user") return m.login_error_blocked();
  return m.login_error_failed();
}

/** Where the identity provider returns the browser: the login page, which then redirects on. */
function callbackFor(redirectTo: string | undefined): string {
  return redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";
}

/** Starts the sign-in through `providerId`; on success the browser is already navigating. */
export async function startSignIn(providerId: ProviderId, redirectTo: string | undefined) {
  return authClient.signIn.sso({
    providerId,
    callbackURL: callbackFor(redirectTo),
    errorCallbackURL: "/login",
  });
}
