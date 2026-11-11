// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Session lifetimes, owner decision on #42 (ASVS V7.1.1, V7.3.1, V7.3.2). Relative imports:
// `pnpm db:seed` loads auth.ts, and with it this file, in plain Node.

const HOUR_SECONDS = 60 * 60;

/** A session ends 8 hours after it was last refreshed (the sliding idle limit), in seconds. */
export const SESSION_EXPIRES_IN_SECONDS = 8 * HOUR_SECONDS;

/** A session in use is refreshed at most once an hour, in seconds (better-auth `updateAge`). */
export const SESSION_UPDATE_AGE_SECONDS = HOUR_SECONDS;

/**
 * A session ends 24 hours after sign-in however much it is used, in seconds. Migration
 * `0006_session_absolute_lifetime` holds the same limit in the database.
 */
export const SESSION_ABSOLUTE_MAX_SECONDS = 24 * HOUR_SECONDS;

/**
 * Tells whether a session signed in at `createdAt` is past its absolute lifetime at `now`.
 * An unreadable `createdAt` counts as past it, so the check fails closed.
 */
export function isPastAbsoluteLifetime(createdAt: Date, now: Date): boolean {
  const started = createdAt.getTime();
  if (!Number.isFinite(started)) return true;
  return now.getTime() - started >= SESSION_ABSOLUTE_MAX_SECONDS * 1000;
}
