// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The world of the records journeys (S11, S12, S16, #268), written straight into this run's
// database: a simulation of the seeded teacher with one lab, a student of its own in that lab,
// and an invented catalogue test; a second lab in another simulation when a journey needs one.
// Every name is invented (Q-PRIV-4).
import { randomInt } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { withCheckDigit } from "../../src/lib/lab-number.ts";
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

/** A simulation's state as a journey needs it: running, or finished with its times. */
export type SeededState = "running" | "finished";

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

/** Stores a simulation of the seeded teacher in `state` with one lab that holds `studentId`. */
async function labWith(
  db: Kysely<DB>,
  studentId: string,
  simulation: string,
  lab: string,
  state: SeededState,
  createdAt: Date,
): Promise<{ simulationId: string; labId: string }> {
  const teacher = await db
    .selectFrom("user")
    .select("id")
    .where("email", "=", "teacher@example.test")
    .executeTakeFirstOrThrow();
  const started = new Date(createdAt.getTime() + 60_000);
  const { id: simulationId } = await db
    .insertInto("simulations")
    .values({
      name: simulation,
      created_by: teacher.id,
      created_at: createdAt,
      state,
      started_at: started,
      finished_at: state === "finished" ? new Date(started.getTime() + 60_000) : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("simulation_teachers")
    .values({ simulation_id: simulationId, user_id: teacher.id })
    .execute();
  const { id: labId } = await db
    .insertInto("labs")
    .values({ simulation_id: simulationId, name: lab })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("lab_members")
    .values({ simulation_id: simulationId, lab_id: labId, user_id: studentId, joined_via: "email" })
    .execute();
  return { simulationId, labId };
}

/** Stores a simulation with one lab and its student, under the run-unique `suffix`. */
export async function seedLabRecords(
  suffix: string,
  state: SeededState = "running",
): Promise<SeededLab> {
  const student = await copyAccount("student@example.test", "records-student");
  const db = database();
  try {
    const simulation = `Records ${suffix}`;
    const lab = `Lab ${suffix}`;
    const { simulationId, labId } = await labWith(
      db,
      student.id,
      simulation,
      lab,
      state,
      new Date(Date.now() - 3_600_000),
    );
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

/** Puts `studentId` in a second lab of a newer running simulation and returns that lab. */
export async function seedSecondLab(
  studentId: string,
  suffix: string,
): Promise<{ labId: string; lab: string; simulation: string }> {
  const db = database();
  try {
    const simulation = `Second records ${suffix}`;
    const lab = `Second lab ${suffix}`;
    const { labId } = await labWith(db, studentId, simulation, lab, "running", new Date());
    return { labId, lab, simulation };
  } finally {
    await db.destroy();
  }
}

/** Stores a lab of another student, which the journey's student is not in, and returns its id. */
export async function seedForeignLab(suffix: string): Promise<string> {
  const other = await copyAccount("student@example.test", "records-other");
  const db = database();
  try {
    const { labId } = await labWith(
      db,
      other.id,
      `Foreign ${suffix}`,
      `Foreign lab ${suffix}`,
      "running",
      new Date(),
    );
    return labId;
  } finally {
    await db.destroy();
  }
}

/** Stores a control request with one sample in `lab` and returns the sample's lab number. */
export async function seedControlRequest(lab: SeededLab): Promise<string> {
  const db = database();
  try {
    const labNumber = withCheckDigit(String(randomInt(100_000_000, 1_000_000_000)));
    await db.transaction().execute(async (trx) => {
      const { id } = await trx
        .insertInto("requests")
        .values({ simulation_id: lab.simulationId, lab_id: lab.labId, kind: "control" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("request_tests")
        .values({
          request_id: id,
          test_id: (
            await trx
              .selectFrom("catalogue_tests")
              .select("id")
              .where("name", "=", lab.test)
              .executeTakeFirstOrThrow()
          ).id,
        })
        .execute();
      await trx
        .insertInto("samples")
        .values({
          simulation_id: lab.simulationId,
          lab_id: lab.labId,
          request_id: id,
          sample_number: "QC-SEED",
          material: "control material",
          lab_number: labNumber,
        })
        .execute();
    });
    return labNumber;
  } finally {
    await db.destroy();
  }
}

/**
 * Puts a fresh copy of the dev student into the lab named `labName` of `simulationId`, which a
 * teacher created on screen, and returns the account: the start of a simulation needs a student
 * in a lab (#394), and a journey has no student who signs in to link.
 */
export async function seatStudent(simulationId: string, labName: string): Promise<TestAccount> {
  const student = await copyAccount("student@example.test", "seated-student");
  const db = database();
  try {
    const lab = await db
      .selectFrom("labs")
      .select("id")
      .where("simulation_id", "=", simulationId)
      .where("name", "=", labName)
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lab_members")
      .values({
        simulation_id: simulationId,
        lab_id: lab.id,
        user_id: student.id,
        joined_via: "email",
      })
      .execute();
    return student;
  } finally {
    await db.destroy();
  }
}
