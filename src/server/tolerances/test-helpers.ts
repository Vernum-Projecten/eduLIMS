// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the tolerance tests: the simulation world, running, with an invented
// catalogue test (Q-PRIV-4). Test support only.
import type { Kysely } from "kysely";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { startSimulation } from "../simulations/state.ts";
import { NOW, type World, world } from "../simulations/test-helpers.ts";
import { setTolerance } from "./actions.ts";

/** The world of the simulation tests with its first simulation running and one test. */
export async function runningWorld(db: Kysely<DB>): Promise<{ w: World; testId: string }> {
  const w = await world(db);
  const testId = await catalogueTest(db, "Creatinine (invented)");
  const started = await startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
  if (!started.ok) throw new Error(started.error);
  return { w, testId };
}

/** Sets a tolerance as the world's first student, in their own lab, and fails on a refusal. */
export async function studentSets(
  db: Kysely<DB>,
  w: World,
  testId: string,
  lower: string,
  upper: string,
): Promise<boolean> {
  const result = await setTolerance(db, w.student, { labId: w.labId, testId, lower, upper });
  if (!result.ok) throw new Error(result.error);
  return result.value.changed;
}
