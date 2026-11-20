// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The life cycle of a committed test database for a whole test file (#318, #345): a fresh one
// before each case, dropped after it. Test support only.
import { afterEach, beforeEach } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "./test-committed-db.ts";

const HOOK_TIMEOUT_MS = 60_000;

/**
 * Registers the hooks that give each case of the calling file its own committed database with a
 * pool of `max` connections, and returns the accessor of the current one.
 */
export function committedTestDbPerCase(max = 8): () => CommittedTestDb {
  let committed: CommittedTestDb | undefined;
  beforeEach(async () => {
    committed = await createCommittedTestDb(max);
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await committed?.destroy();
    committed = undefined;
  }, HOOK_TIMEOUT_MS);
  return () => {
    if (!committed) throw new Error("no committed test database");
    return committed;
  };
}
