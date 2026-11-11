// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * How long each domain's cached data counts as fresh, in milliseconds. Every query options
 * factory sets its own `staleTime` from this table; the TanStack rule (§Query conventions)
 * lists the reasons.
 */
export const STALE_TIME = {
  /** The session: always revalidated, so a role change or a revoked session applies at once. */
  session: 0,
  /** A page of the users table: other administrators change it, but rarely within a minute. */
  adminUsersList: 30_000,
  /** The user detail sheet: its active sessions change on every sign-in, so it ages faster. */
  adminUserDetail: 15_000,
  /**
   * The sign-in methods of the login page: an administrator rarely changes a provider, and a
   * full page load (a callback, a language switch) or a sign-out starts from an empty cache.
   */
  loginOptions: 30_000,
  /** A provider's SCIM section: its token's last use moves with every directory sync. */
  scimDetail: 15_000,
} as const;

/** The `staleTime` of a query that sets none (every factory should; see {@link STALE_TIME}). */
export const DEFAULT_STALE_TIME = 30_000;

/**
 * How often a failed read retries before the route's error state with its retry button shows.
 * One retry rides out a dropped connection without keeping the user waiting for seconds.
 */
export const QUERY_RETRY = 1;
