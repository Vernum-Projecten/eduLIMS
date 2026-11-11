// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The identity-provider model shared by the server, the login page and the Admin screen
// (ADR 0015). Providers live in the database; nothing here names a vendor.
// Relative imports: `pnpm db:seed` and the host CLIs load this in plain Node.

/**
 * The pattern of a provider id: a lowercase slug. It is in the callback and ACS URLs the
 * identity provider has registered and in every `account.providerId`, so it never changes.
 */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/** Ids a provider may not take: the role source and the sign-in method eduLIMS uses itself. */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set(["local", "credential"]);

declare const providerIdBrand: unique symbol;
/** The id of an identity provider (`ssoProvider.providerId`, `identity_provider.provider_id`). */
export type ProviderId = string & { readonly [providerIdBrand]: true };

/** Returns `value` as a {@link ProviderId} when it is a slug that is not reserved, else `null`. */
export function parseProviderId(value: unknown): ProviderId | null {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) return null;
  if (RESERVED_PROVIDER_IDS.has(value)) return null;
  return value as ProviderId;
}

/**
 * Returns a fixed provider id (the development providers) as a {@link ProviderId}.
 *
 * @throws Error when `value` is not a valid, unreserved slug: a coding error.
 */
export function providerIdOf(value: string): ProviderId {
  const id = parseProviderId(value);
  if (id === null) throw new Error(`not a provider id: ${value}`);
  return id;
}

/** The protocols a provider can speak. */
export const PROVIDER_PROTOCOLS = ["oidc", "saml"] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

/** The icons an administrator can pick for a login button (a fixed lucide set). */
export const PROVIDER_ICONS = ["key-round", "building", "school", "shield", "globe"] as const;
export type ProviderIcon = (typeof PROVIDER_ICONS)[number];

/** An enabled identity provider as the login page offers it: never its configuration. */
export interface IdentityProviderOption {
  id: ProviderId;
  /** The provider's name in the active locale; the button reads "Sign in with" and it. */
  label: string;
  icon: ProviderIcon;
  protocol: ProviderProtocol;
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

/** Rejection code for a sign-in through a provider an administrator disabled. */
export const PROVIDER_DISABLED_ERROR = "provider_disabled";

/**
 * Returns a sign-in error code from the `error` search parameter in a stable form: better-auth
 * reports a refused link as `account not linked` on the OIDC callback.
 */
export function normalizeSignInError(error: string): string {
  return error
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}
