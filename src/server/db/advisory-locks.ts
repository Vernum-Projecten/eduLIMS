// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every PostgreSQL advisory lock key eduLIMS uses, in one place, so two features never share a
// key by accident (advisory-locks.test.ts checks they are distinct). A new lock adds its key
// here. Relative imports only: the host CLI loads this in plain Node.

// NOTE: no requirement governs this: our own design. The values are arbitrary bigints; only
// their distinctness matters, and they stay fixed so running replicas of two versions agree.

/** Guards one retention prune (B4, #65): one replica, or the operator's `prune`, at a time. */
export const RETENTION_PRUNE_LOCK_KEY = 6_502_026_111;

/**
 * Serialises the database tests: each test holds it for its whole transaction, so test files
 * that run in parallel use the run's database one at a time (`src/server/db/test-db.ts`).
 * PostgreSQL scopes it to that database, so it never meets the app's locks.
 */
export const TEST_DATABASE_LOCK_KEY = 7_212_026_018;

/**
 * Guards the scheduled integration check (B3, #35): one replica checks FerroEHR and FerroBRIDGE
 * per interval (`src/server/integrations/checks.ts`).
 */
export const INTEGRATION_CHECK_LOCK_KEY = 3_502_026_011;

/** All keys of this registry, by name. */
export const ADVISORY_LOCK_KEYS = {
  RETENTION_PRUNE_LOCK_KEY,
  TEST_DATABASE_LOCK_KEY,
  INTEGRATION_CHECK_LOCK_KEY,
} as const;
