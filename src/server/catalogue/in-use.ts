// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// How simulations use a test of the catalogue (D9, #266). A used test keeps its unit and its
// source, and can be retired but not deleted; while a running simulation uses it, its material and
// who calculates are fixed as well (maintainer, 2026-11-19).
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { type CatalogueTestId, parseCatalogueTestId, type TestUsage } from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";

/**
 * Returns how simulations use each test of `ids`: `running` when a running simulation uses it,
 * `used` when only other simulations do, `unused` otherwise. A simulation uses a test when one of
 * its correct values names it (D10, #267). A test missing from the map is unused. Runs inside the
 * caller's transaction when given one; starting a simulation locks its tests `FOR SHARE`, so a
 * caller that holds a test `FOR UPDATE` reads the state that start committed.
 */
export async function testUsage(
  db: Kysely<DB>,
  ids: readonly CatalogueTestId[],
): Promise<ReadonlyMap<CatalogueTestId, TestUsage>> {
  if (ids.length === 0) return new Map();
  // TODO(#268): count a test a request names as used, and as running in a running simulation.
  const rows = await db
    .selectFrom("correct_values")
    .innerJoin("simulations", "simulations.id", "correct_values.simulation_id")
    .select([
      "correct_values.test_id",
      sql<boolean>`bool_or(simulations.state = 'running')`.as("running"),
    ])
    .where("correct_values.test_id", "in", ids)
    .groupBy("correct_values.test_id")
    .execute();
  const usage = new Map<CatalogueTestId, TestUsage>();
  for (const row of rows) {
    const id = parseCatalogueTestId(row.test_id);
    if (id !== null) usage.set(id, row.running ? "running" : "used");
  }
  return usage;
}

/** Returns how simulations use the test `id`; see {@link testUsage}. */
export async function usageOf(db: Kysely<DB>, id: CatalogueTestId): Promise<TestUsage> {
  return (await testUsage(db, [id])).get(id) ?? "unused";
}
