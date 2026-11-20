// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the results journeys (S14, S15, #270), written straight into this run's database:
// a running simulation of the seeded teacher with two labs, one copied student in each, and in the
// first lab an invented patient with one request on one sample for five invented tests: three
// entered by hand with the team's tolerance (the second and third with one measurement already),
// one from the Afinion 2 and one by hand without a tolerance. Everything is invented (Q-PRIV-4).
import { randomInt, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withCheckDigit } from "../../src/lib/lab-number.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { copyAccount, type TestAccount } from "./accounts";
import { finishRunning } from "./running-simulation";

/** One seeded test: its id and its name. */
export interface SeededTest {
  id: string;
  name: string;
}

/** What {@link seedResults} stored. */
export interface ResultsWorld {
  simulationId: string;
  labId: string;
  lab: string;
  otherLabId: string;
  otherLab: string;
  patient: string;
  patientId: string;
  /** The EHR id FerroEHR would have given the patient; a release needs one (#148, #364). */
  ehrId: string;
  requestId: string;
  sampleId: string;
  /** Entered by hand, with a tolerance of 4 to 6 and no measurement: the keyboard journey. */
  journey: SeededTest;
  /** Entered by hand, with a tolerance of 4 to 6 and one measurement of 5: the refusals. */
  refused: SeededTest;
  /** Entered by hand, with a tolerance of 4 to 6 and one measurement of 9: the narrow dialog. */
  narrow: SeededTest;
  /** Measured on the Afinion 2: no entry by hand. */
  afinion: SeededTest;
  /** Entered by hand without a tolerance: no release. */
  untolerated: SeededTest;
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

/** Runs `write` against this run's database and closes the connection. */
async function withDatabase<T>(write: (db: Kysely<DB>) => Promise<T>): Promise<T> {
  const db = database();
  try {
    return await write(db);
  } finally {
    await db.destroy();
  }
}

/** Stores the journeys' world under the run-unique `suffix`. */
export async function seedResults(suffix: string): Promise<ResultsWorld> {
  const student = await copyAccount("student@example.test", "results-student");
  const otherStudent = await copyAccount("student@example.test", "results-other");
  const names = {
    lab: `Bright Burettes ${suffix}`,
    otherLab: `Calm Centrifuges ${suffix}`,
    patient: `Noor Testpatient ${suffix}`,
  };
  return withDatabase((db) =>
    db.transaction().execute(async (trx) => {
      const teacher = await trx
        .selectFrom("user")
        .select("id")
        .where("email", "=", "teacher@example.test")
        .executeTakeFirstOrThrow();
      // NOTE: #386; one running simulation at a time, so an earlier journey's one is finished.
      await finishRunning(trx);
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
      const test = async (name: string, source: "manual" | "afinion"): Promise<SeededTest> => {
        const full = `${name} ${suffix}`;
        const { id } = await trx
          .insertInto("catalogue_tests")
          .values({
            name: full,
            unit: "mmol/L",
            material: "plasma",
            source,
            afinion_analyte: source === "afinion" ? `AN${suffix}` : null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { id, name: full };
      };
      const journey = await test("Urate", "manual");
      const refused = await test("Lactate", "manual");
      const narrow = await test("Glucose", "manual");
      const afinion = await test("Cystatin", "afinion");
      const untolerated = await test("Albumin", "manual");
      const ehrId = randomUUID();
      const { id: patientId } = await trx
        .insertInto("patients")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          ehr_id: ehrId,
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
        .values(
          [journey, refused, narrow, afinion, untolerated].map((t) => ({
            request_id: requestId,
            test_id: t.id,
          })),
        )
        .execute();
      const { id: sampleId } = await trx
        .insertInto("samples")
        .values({
          simulation_id: simulationId,
          lab_id: labId,
          request_id: requestId,
          sample_number: `R-${suffix}`,
          material: "plasma",
          lab_number: withCheckDigit(String(randomInt(100_000_000, 1_000_000_000))),
          created_by: student.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      for (const t of [journey, refused, narrow]) {
        await trx
          .insertInto("lab_tolerances")
          .values({
            simulation_id: simulationId,
            lab_id: labId,
            test_id: t.id,
            lower_limit: "4",
            upper_limit: "6",
            set_by: student.id,
          })
          .execute();
      }
      for (const [t, value] of [
        [refused, "5"],
        [narrow, "9"],
      ] as const) {
        await trx
          .insertInto("measurements")
          .values({
            simulation_id: simulationId,
            lab_id: labId,
            request_id: requestId,
            test_id: t.id,
            sample_id: sampleId,
            value,
            source: "manual",
            recorded_by: student.id,
          })
          .execute();
      }
      return {
        ...names,
        simulationId,
        labId,
        otherLabId,
        patientId,
        ehrId,
        requestId,
        sampleId,
        journey,
        refused,
        narrow,
        afinion,
        untolerated,
        student,
        otherStudent,
      };
    }),
  );
}

/**
 * Sets the patient's EHR id: `null` makes it pending, as a registration that FerroEHR did not
 * answer leaves it (#364), so the release gate refuses (#148).
 */
export function setPatientEhr(world: ResultsWorld, ehrId: string | null): Promise<void> {
  return withDatabase(async (db) => {
    await db
      .updateTable("patients")
      .set({ ehr_id: ehrId })
      .where("id", "=", world.patientId)
      .execute();
  });
}

/** Sets a new tolerance for `testId`, as a classmate would (the dialog's tolerance goes stale). */
export function changeTolerance(world: ResultsWorld, testId: string): Promise<void> {
  return withDatabase(async (db) => {
    await db
      .insertInto("lab_tolerances")
      .values({
        simulation_id: world.simulationId,
        lab_id: world.labId,
        test_id: testId,
        lower_limit: "4.5",
        upper_limit: "5.5",
        set_by: world.student.id,
      })
      .execute();
  });
}

/** Releases the first measurement of `testId`, as a classmate would. */
export function releaseElsewhere(world: ResultsWorld, testId: string): Promise<void> {
  return withDatabase(async (db) => {
    const measurement = await db
      .selectFrom("measurements")
      .select("id")
      .where("request_id", "=", world.requestId)
      .where("test_id", "=", testId)
      .orderBy("recorded_at")
      .executeTakeFirstOrThrow();
    const tolerance = await db
      .selectFrom("lab_tolerances")
      .select("id")
      .where("lab_id", "=", world.labId)
      .where("test_id", "=", testId)
      .orderBy("set_at", "desc")
      .executeTakeFirstOrThrow();
    await db
      .updateTable("request_tests")
      .set({ released_measurement_id: measurement.id, released_tolerance_id: tolerance.id })
      .where("request_id", "=", world.requestId)
      .where("test_id", "=", testId)
      .execute();
  });
}

/** Finishes the journeys' simulation, as the teacher's finish would. */
export function finishResults(world: ResultsWorld): Promise<void> {
  return withDatabase(async (db) => {
    await db
      .updateTable("simulations")
      .set({ state: "finished", finished_at: sql<Date>`now()` })
      .where("id", "=", world.simulationId)
      .execute();
  });
}
