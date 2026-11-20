// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the results journey (S14, S15, #270), written straight into this run's database:
// a running simulation of the seeded teacher with two labs, one copied student in each, one
// invented test entered by hand, and in the first lab an invented patient with a request for that
// test on one sample and the team's own tolerance. Everything is invented (Q-PRIV-4).
import { randomInt } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withCheckDigit } from "../../src/lib/lab-number.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { copyAccount, type TestAccount } from "./accounts";

/** What {@link seedResults} stored. */
export interface ResultsWorld {
  simulationId: string;
  labId: string;
  lab: string;
  otherLabId: string;
  otherLab: string;
  patient: string;
  testName: string;
  sampleNumber: string;
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
export async function seedResults(suffix: string): Promise<ResultsWorld> {
  const student = await copyAccount("student@example.test", "results-student");
  const otherStudent = await copyAccount("student@example.test", "results-other");
  const names = {
    lab: `Bright Burettes ${suffix}`,
    otherLab: `Calm Centrifuges ${suffix}`,
    patient: `Noor Testpatient ${suffix}`,
    testName: `Urate ${suffix}`,
    sampleNumber: `R-${suffix}`,
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
          name: `Results journey ${suffix}`,
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
      const { id: testId } = await trx
        .insertInto("catalogue_tests")
        .values({ name: names.testName, unit: "mmol/L", material: "plasma", source: "manual" })
        .returning("id")
        .executeTakeFirstOrThrow();
      const { id: patientId } = await trx
        .insertInto("patients")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          name: names.patient,
          date_of_birth: "1979-06-02",
          sex: "unknown",
          identifier: `PID-${suffix}`,
          created_by: student.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const { id: requestId } = await trx
        .insertInto("requests")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          kind: "patient",
          patient_id: patientId,
          requester: "Dr. Invented",
          created_by: student.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("request_tests")
        .values({ request_id: requestId, test_id: testId })
        .execute();
      await trx
        .insertInto("samples")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          request_id: requestId,
          sample_number: names.sampleNumber,
          material: "plasma",
          lab_number: withCheckDigit(String(randomInt(100_000_000, 1_000_000_000))),
          created_by: student.id,
        })
        .execute();
      await trx
        .insertInto("lab_tolerances")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          test_id: testId,
          lower_limit: "4",
          upper_limit: "6",
          set_by: student.id,
        })
        .execute();
      return { ...names, simulationId, labId, otherLabId, student, otherStudent };
    });
  } finally {
    await db.destroy();
  }
}
