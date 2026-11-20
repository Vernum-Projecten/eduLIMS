// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the records journeys (S11, S12, S16, #268), written straight into this run's
// database: a running simulation of the seeded teacher with one lab, a student of its own in
// that lab, and an invented catalogue test. Every name is invented (Q-PRIV-4).
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { copyAccount, type TestAccount } from "./accounts";

/** What {@link seedLabRecords} stored. */
export interface SeededLab {
  student: TestAccount;
  simulationId: string;
  labId: string;
  simulation: string;
  lab: string;
  test: string;
}

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

/** Stores a running simulation with one lab and its student, under the run-unique `suffix`. */
export async function seedLabRecords(suffix: string): Promise<SeededLab> {
  const student = await copyAccount("student@example.test", "records-student");
  const db = database();
  try {
    const teacher = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", "teacher@example.test")
      .executeTakeFirstOrThrow();
    const simulation = `Records ${suffix}`;
    const { id: simulationId } = await db
      .insertInto("simulations")
      .values({
        name: simulation,
        created_by: teacher.id,
        state: "running",
        started_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: teacher.id })
      .execute();
    const lab = `Lab ${suffix}`;
    const { id: labId } = await db
      .insertInto("labs")
      .values({ simulation_id: simulationId, name: lab })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lab_members")
      .values({
        simulation_id: simulationId,
        lab_id: labId,
        user_id: student.id,
        joined_via: "email",
      })
      .execute();
    const test = `Glucose ${suffix}`;
    await db
      .insertInto("catalogue_tests")
      .values({ name: test, unit: "mmol/L", material: "plasma", source: "manual" })
      .execute();
    return { student, simulationId, labId, simulation, lab, test };
  } finally {
    await db.destroy();
  }
}
