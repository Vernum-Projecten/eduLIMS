// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// How simulations use a test of the catalogue (D9, #266). A used test keeps its unit and its
// source, and can be retired but not deleted; while a running simulation uses it, its material and
// who calculates are fixed as well (maintainer, 2026-11-19).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { CatalogueTestId, TestUsage } from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";

/**
 * Returns how simulations use each test of `ids`: `running` when a running simulation uses it,
 * `used` when only other simulations do, `unused` otherwise. A test missing from the map is
 * unused. Runs inside the caller's transaction when given one.
 */
export async function testUsage(
  _db: Kysely<DB>,
  _ids: readonly CatalogueTestId[],
): Promise<ReadonlyMap<CatalogueTestId, TestUsage>> {
  // NOTE: #266; no table refers to a test yet, so every test is unused. #267 (correct values) and
  // #268 (requests) add their tables and make this query them, in the same transaction.
  // TODO(#267): count a test with a correct value in any simulation as used, and as running
  // while that simulation runs.
  // TODO(#268): count a test a request names as used, and as running in a running simulation.
  return new Map();
}

/** Returns how simulations use the test `id`; see {@link testUsage}. */
export async function usageOf(db: Kysely<DB>, id: CatalogueTestId): Promise<TestUsage> {
  return (await testUsage(db, [id])).get(id) ?? "unused";
}
