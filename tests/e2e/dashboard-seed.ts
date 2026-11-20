// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the dashboard journey (D11, #271), written straight into this run's database: a
// running simulation of the seeded teacher with two labs, an answer model of two samples of one
// invented test with its limits, and in the first lab one released result inside the yellow
// limit, one open request; the second lab has one result released outside the red limit. Every
// name and value is invented (Q-PRIV-4).
import { randomInt } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withCheckDigit } from "../../src/lib/lab-number.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { finishRunning } from "./running-simulation";

/** What {@link seedDashboard} stored, by name. */
export interface DashboardWorld {
  simulationId: string;
  simulation: string;
  /** The lab with one green and one open cell. */
  first: string;
  /** The lab with one red cell. */
  second: string;
  test: string;
  /** The answer model's sample numbers. */
  samples: readonly [string, string];
}

async function control(
  trx: Kysely<DB>,
  simulationId: string,
  labId: string,
  testId: string,
  sampleNumber: string,
) {
  const { id: requestId } = await trx
    .insertInto("requests")
    .values({ simulation_id: simulationId, lab_id: labId, kind: "control" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("request_tests")
    .values({ request_id: requestId, test_id: testId })
    .execute();
  const { id: sampleId } = await trx
    .insertInto("samples")
    .values({
      simulation_id: simulationId,
      lab_id: labId,
      request_id: requestId,
      sample_number: sampleNumber,
      material: "plasma",
      lab_number: withCheckDigit(String(randomInt(100_000_000, 1_000_000_000))),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { requestId, sampleId };
}

async function released(
  trx: Kysely<DB>,
  simulationId: string,
  labId: string,
  testId: string,
  sampleNumber: string,
  value: string,
) {
  const { requestId, sampleId } = await control(trx, simulationId, labId, testId, sampleNumber);
  const { id: measurementId } = await trx
    .insertInto("measurements")
    .values({
      simulation_id: simulationId,
      lab_id: labId,
      request_id: requestId,
      test_id: testId,
      sample_id: sampleId,
      value,
      source: "manual",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const { id: toleranceId } = await trx
    .insertInto("lab_tolerances")
    .values({
      simulation_id: simulationId,
      lab_id: labId,
      test_id: testId,
      lower_limit: "1",
      upper_limit: "20",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .updateTable("request_tests")
    .set({ released_measurement_id: measurementId, released_tolerance_id: toleranceId })
    .where("request_id", "=", requestId)
    .where("test_id", "=", testId)
    .execute();
}

/** Stores the dashboard's world under the run-unique `suffix`; an earlier running one ends. */
export async function seedDashboard(suffix: string): Promise<DashboardWorld> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  const world = {
    simulation: `Board journey ${suffix}`,
    first: `Amber Ampoules ${suffix}`,
    second: `Agile Aliquots ${suffix}`,
    test: `Creatinine ${suffix}`,
    samples: [`D-${suffix}-1`, `D-${suffix}-2`] as const,
  };
  try {
    return await db.transaction().execute(async (trx) => {
      await finishRunning(trx);
      const teacher = await trx
        .selectFrom("user")
        .select("id")
        .where("email", "=", "teacher@example.test")
        .executeTakeFirstOrThrow();
      const { id: simulationId } = await trx
        .insertInto("simulations")
        .values({
          name: world.simulation,
          created_by: teacher.id,
          state: "running",
          started_at: sql<Date>`now()`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("simulation_teachers")
        .values({ simulation_id: simulationId, user_id: teacher.id })
        .execute();
      const lab = async (name: string) =>
        (
          await trx
            .insertInto("labs")
            .values({ simulation_id: simulationId, name })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      const first = await lab(world.first);
      const second = await lab(world.second);
      const { id: testId } = await trx
        .insertInto("catalogue_tests")
        .values({ name: world.test, unit: "mmol/L", material: "plasma", source: "manual" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("correct_values")
        .values(
          world.samples.map((sampleNumber) => ({
            simulation_id: simulationId,
            test_id: testId,
            sample_number: sampleNumber,
            value: "10",
          })),
        )
        .execute();
      await trx
        .insertInto("simulation_test_limits")
        .values({
          simulation_id: simulationId,
          test_id: testId,
          kind: "absolute",
          yellow_limit: "0.5",
          red_limit: "1",
        })
        .execute();
      await released(trx, simulationId, first, testId, world.samples[0], "10.4");
      await control(trx, simulationId, first, testId, world.samples[1]);
      await released(trx, simulationId, second, testId, world.samples[0], "12");
      return { ...world, simulationId };
    });
  } finally {
    await db.destroy();
  }
}
