// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the tolerance journey (S13, #269), written straight into this run's database: a
// running simulation of the seeded teacher with two labs, one copied student in each, and one
// invented catalogue test. Everything is invented (Q-PRIV-4).
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { copyAccount, type TestAccount } from "./accounts";

/** What {@link seedTolerances} stored. */
export interface ToleranceWorld {
  simulationId: string;
  simulation: string;
  labId: string;
  lab: string;
  otherLabId: string;
  otherLab: string;
  testName: string;
  student: TestAccount;
  otherStudent: TestAccount;
}

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

/** Stores the journey's world under the run-unique `suffix`. */
export async function seedTolerances(suffix: string): Promise<ToleranceWorld> {
  const student = await copyAccount("student@example.test", "tolerance-student");
  const otherStudent = await copyAccount("student@example.test", "tolerance-other");
  const names = {
    simulation: `Tolerance journey ${suffix}`,
    lab: `Steady Pipettes ${suffix}`,
    otherLab: `Quiet Cuvettes ${suffix}`,
    testName: `Lactate ${suffix}`,
  };
  const db = database();
  try {
    return await db.transaction().execute(async (trx) => {
      const teacher = await trx
        .selectFrom("user")
        .select("id")
        .where("email", "=", "teacher@example.test")
        .executeTakeFirstOrThrow();
      const { id: simulationId } = await trx
        .insertInto("simulations")
        .values({
          name: names.simulation,
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
      const lab = async (name: string, userId: string) => {
        const { id } = await trx
          .insertInto("labs")
          .values({ simulation_id: simulationId, name })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("lab_members")
          .values({ simulation_id: simulationId, lab_id: id, user_id: userId, joined_via: "email" })
          .execute();
        return id;
      };
      const labId = await lab(names.lab, student.id);
      const otherLabId = await lab(names.otherLab, otherStudent.id);
      await trx
        .insertInto("catalogue_tests")
        .values({ name: names.testName, unit: "mmol/L", material: "plasma", source: "manual" })
        .execute();
      return { ...names, simulationId, labId, otherLabId, student, otherStudent };
    });
  } finally {
    await db.destroy();
  }
}

/** Finishes the journey's simulation, as the teacher's finish would. */
export async function finishTolerances(simulationId: string): Promise<void> {
  const db = database();
  try {
    await db
      .updateTable("simulations")
      .set({ state: "finished", finished_at: sql<Date>`now()` })
      .where("id", "=", simulationId)
      .execute();
  } finally {
    await db.destroy();
  }
}
