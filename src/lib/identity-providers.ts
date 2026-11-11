// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** Identity providers eduLIMS can enable; each has its own env vars and login button. */
export type IdentityProviderId = "microsoft" | "keycloak";

/** A configured identity provider as offered on the login page. */
export interface IdentityProviderOption {
  id: IdentityProviderId;
  /** The operator's button text (`KEYCLOAK_LABEL`); without it the UI shows a localized default. */
  label?: string;
}

/** better-auth rejection code for an IdP sign-in without a mapped eduLIMS role. */
export const NO_ROLE_ERROR = "no_edulims_role";

/**
 * better-auth rejection code for an IdP sign-in whose roles form a set eduLIMS does not allow
 * (student with teacher or admin, ADR 0012).
 */
export const ROLE_CONFLICT_ERROR = "role_conflict";

/**
 * better-auth rejection code for a sign-in from a provider with the email of a user who signs in
 * through another provider. Account linking is off (#39), so the accounts are never merged.
 */
export const ACCOUNT_NOT_LINKED_ERROR = "account_not_linked";
