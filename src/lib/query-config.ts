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
  /** A page of the analyser register (B3): it changes rarely, and every change invalidates it. */
  adminAnalysersList: 30_000,
  /**
   * The integration status (B3): the scheduled check writes a new result every minute, so the
   * screen counts it stale at once and refetches on the interval in {@link INTEGRATION_REFETCH_MS}.
   */
  integrationStatus: 0,
} as const;

// NOTE: B3 ("unreachable … within 5 minutes"); our own interval: a check result reaches an open
// screen within 30 s of being written, well inside the 5 minutes with the 60 s schedule.
export const INTEGRATION_REFETCH_MS = 30_000;

/** The `staleTime` of a query that sets none (every factory should; see {@link STALE_TIME}). */
export const DEFAULT_STALE_TIME = 30_000;

/**
 * How often a failed read retries before the route's error state with its retry button shows.
 * One retry rides out a dropped connection without keeping the user waiting for seconds.
 */
export const QUERY_RETRY = 1;
