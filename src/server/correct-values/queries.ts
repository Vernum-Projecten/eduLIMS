// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's read of a simulation's correct values and accuracy limits (D10, D13, #267). It
// is the only read that selects them, and it starts from a teacher row of the simulation for the
// session user, in SQL (D11, R-13). No student-callable function imports this module.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import {
  type AccuracyLimits,
  asCorrectValue,
  type CorrectValue,
  parseLimitKind,
} from "../../lib/correct-values.ts";
import { parseSimulationId, type SimulationState } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "../simulations/access.ts";
import { toSimulationState } from "../simulations/state.ts";

/** One correct value of the teacher's table. */
export interface CorrectValueEntry {
  id: string;
  sampleNumber: string;
  testId: string;
  value: CorrectValue;
  updatedAt: string;
}

/** A test the simulation uses, with its limits and how many correct values name it. */
export interface SimulationTestEntry {
  id: string;
  name: string;
  unit: string | null;
  retired: boolean;
  values: number;
  limits: AccuracyLimits | null;
}

/** The correct-values section of a simulation's page, teacher-scoped (Q-SIM-1). */
export interface CorrectValuesPage {
  simulationId: string;
  state: SimulationState;
  values: CorrectValueEntry[];
  /** The tests with a correct value or a limit in this simulation, by name. */
  tests: SimulationTestEntry[];
  /** The active catalogue tests a new correct value may name, by name. */
  options: { id: string; name: string; unit: string | null }[];
}

function limitsOf(row: {
  kind: string | null;
  yellow: string | null;
  red: string | null;
}): AccuracyLimits | null {
  if (row.kind === null || row.yellow === null || row.red === null) return null;
  const kind = parseLimitKind(row.kind);
  if (kind === undefined) throw new Error("simulation_test_limits.kind is not a known kind");
  return { kind, yellow: row.yellow, red: row.red };
}

/**
 * Returns the correct values and limits of a simulation the actor teaches, or `null` for a
 * malformed id, an unknown simulation and another teacher's simulation alike; every `null` is
 * logged as an `authz_fail` probe (ASVS V16.3.2).
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function getCorrectValuesPage(
  db: Kysely<DB>,
  actor: SimulationActor,
  simulationId: string,
): Promise<CorrectValuesPage | null> {
  assertTeacher(actor);
  const id = parseSimulationId(simulationId);
  if (id === null) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const simulation = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select(["s.id", "s.state"])
    .where("s.id", "=", id)
    .where("mine.user_id", "=", actor.id)
    .executeTakeFirst();
  if (!simulation) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const [values, tests, options] = await Promise.all([
    db
      .selectFrom("correct_values as cv")
      .innerJoin("catalogue_tests as t", "t.id", "cv.test_id")
      .select([
        "cv.id",
        "cv.sample_number",
        "cv.test_id",
        sql<string>`cv.value::text`.as("value"),
        "cv.updated_at",
      ])
      .where("cv.simulation_id", "=", id)
      .orderBy(sql`lower(cv.sample_number)`)
      .orderBy("t.name")
      .orderBy("cv.id")
      .execute(),
    db
      .selectFrom("catalogue_tests as t")
      .leftJoin("simulation_test_limits as l", (join) =>
        join.onRef("l.test_id", "=", "t.id").on("l.simulation_id", "=", id),
      )
      .select((eb) => [
        "t.id",
        "t.name",
        "t.unit",
        "t.retired_at",
        "l.kind",
        sql<string | null>`l.yellow_limit::text`.as("yellow"),
        sql<string | null>`l.red_limit::text`.as("red"),
        eb
          .selectFrom("correct_values as cv")
          .select((cb) => cb.fn.countAll<string>().as("n"))
          .whereRef("cv.test_id", "=", "t.id")
          .where("cv.simulation_id", "=", id)
          .as("values"),
      ])
      .where((eb) =>
        eb.or([
          eb("l.simulation_id", "is not", null),
          eb.exists(
            eb
              .selectFrom("correct_values as cv")
              .select("cv.id")
              .whereRef("cv.test_id", "=", "t.id")
              .where("cv.simulation_id", "=", id),
          ),
        ]),
      )
      .orderBy("t.name")
      .orderBy("t.id")
      .execute(),
    db
      .selectFrom("catalogue_tests")
      .select(["id", "name", "unit"])
      .where("retired_at", "is", null)
      .orderBy("name")
      .orderBy("id")
      .execute(),
  ]);
  return {
    simulationId: simulation.id,
    state: toSimulationState(simulation.state),
    values: values.map((row) => ({
      id: row.id,
      sampleNumber: row.sample_number,
      testId: row.test_id,
      value: asCorrectValue(row.value),
      updatedAt: row.updated_at.toISOString(),
    })),
    tests: tests.map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      retired: row.retired_at !== null,
      values: Number(row.values ?? 0),
      limits: limitsOf(row),
    })),
    options: options.map((row) => ({ id: row.id, name: row.name, unit: row.unit })),
  };
}
