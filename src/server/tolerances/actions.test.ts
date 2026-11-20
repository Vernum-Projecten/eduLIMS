// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Setting a team's tolerance (S13, #269) on a real database: one lower and one upper limit per
// test, kept as decimals; every change a new row with an activity-log row of ids only (E4);
// only while the simulation runs; and refused to everyone but a member of the lab.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import {
  auditRows,
  NOW,
  notFoundLine,
  person,
  securityLines,
  world,
} from "../simulations/test-helpers.ts";
import { setTolerance } from "./actions.ts";
import { runningWorld, studentSets } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  return { database, ...(await runningWorld(database)) };
}

function stored(database: Kysely<DB>, labId: string) {
  return database
    .selectFrom("lab_tolerances")
    .select([
      "test_id",
      sql<string>`lower_limit::text`.as("lower"),
      sql<string>`upper_limit::text`.as("upper"),
      "set_by",
    ])
    .where("lab_id", "=", labId)
    .orderBy("set_at")
    .orderBy("id")
    .execute();
}

describe("setting a tolerance (S13)", () => {
  it("stores the lower and upper limit of a test for the student's own lab", async () => {
    const { database, w, testId } = await open();
    expect(await studentSets(database, w, testId, "4.2", "6.35")).toBe(true);
    expect(await stored(database, w.labId)).toEqual([
      { test_id: testId, lower: "4.2", upper: "6.35", set_by: w.student.id },
    ]);
    expect(await stored(database, w.otherLabId)).toEqual([]);
  });

  it("keeps the digits as decimals, never as binary floats", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "0.100000", "123456789.123456");
    expect(await stored(database, w.labId)).toMatchObject([
      { lower: "0.100000", upper: "123456789.123456" },
    ]);
  });

  it("accepts a lower limit equal to the upper limit (S13: a value on a limit is inside)", async () => {
    const { database, w, testId } = await open();
    expect(await studentSets(database, w, testId, "5", "5")).toBe(true);
  });

  it("keeps every change as a new row, so the teacher sees the changes (S13)", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    const classmate = w.labStudents[1];
    if (!classmate) throw new Error("no classmate");
    const changed = await setTolerance(database, classmate, {
      labId: w.labId,
      testId,
      lower: "3.5",
      upper: "6",
    });
    expect(changed).toEqual({ ok: true, value: { changed: true } });
    expect(await stored(database, w.labId)).toEqual([
      { test_id: testId, lower: "4", upper: "6", set_by: w.student.id },
      { test_id: testId, lower: "3.5", upper: "6", set_by: classmate.id },
    ]);
  });

  it("writes nothing when the limits are the same as decimals ('4.0' equals '4')", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    expect(await studentSets(database, w, testId, "4.0", "6.000")).toBe(false);
    expect(await stored(database, w.labId)).toHaveLength(1);
    expect(await auditRows(database, "lab_tolerance_set")).toHaveLength(1);
  });

  it("logs each change with ids only, never a limit (E4)", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4.2", "6.35");
    const [row] = await stored(database, w.labId);
    const ids = await database.selectFrom("lab_tolerances").select("id").execute();
    expect(row).toBeDefined();
    const rows = await auditRows(database, "lab_tolerance_set");
    expect(rows).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { test_id: testId, tolerance_id: ids[0]?.id },
      },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("4.2");
    expect(text).not.toContain("6.35");
  });

  it("lets a retired test keep changing once the lab has a tolerance for it (D9)", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: NOW })
      .where("id", "=", testId)
      .execute();
    expect(await studentSets(database, w, testId, "4", "7")).toBe(true);
  });

  it("is refused by the database with a lower limit above the upper limit", async () => {
    const { database, w, testId } = await open();
    await expect(
      database
        .insertInto("lab_tolerances")
        .values({
          simulation_id: w.simulationId,
          lab_id: w.labId,
          test_id: testId,
          lower_limit: "6",
          upper_limit: "4",
        })
        .execute(),
    ).rejects.toThrow(/lab_tolerances_limits/);
  });

  it("is refused by the database for a lab of another simulation (composite key)", async () => {
    const { database, w, testId } = await open();
    await expect(
      database
        .insertInto("lab_tolerances")
        .values({
          simulation_id: w.simulationId,
          lab_id: w.outsideLabId,
          test_id: testId,
          lower_limit: "4",
          upper_limit: "6",
        })
        .execute(),
    ).rejects.toThrow(/lab_tolerances_lab_fkey/);
  });
});

describe("the refusals of a tolerance (S10, S13)", () => {
  it("refuses an unknown test with test_not_found, logged", async () => {
    const { database, w } = await open();
    const result = await setTolerance(database, w.student, {
      labId: w.labId,
      testId: "01960000-0000-7000-8000-00000000dead",
      lower: "1",
      upper: "2",
    });
    expect(result).toEqual({ ok: false, error: "test_not_found" });
    expect(await auditRows(database, "lab_tolerance_set")).toMatchObject([
      { outcome: "refused", reason_code: "test_not_found", target_id: w.labId },
    ]);
  });

  it("refuses a first tolerance for a retired test with test_retired, logged", async () => {
    const { database, w } = await open();
    const retired = await catalogueTest(database, "Old urea (invented)", { retired: true });
    const result = await setTolerance(database, w.student, {
      labId: w.labId,
      testId: retired,
      lower: "1",
      upper: "2",
    });
    expect(result).toEqual({ ok: false, error: "test_retired" });
    expect(await auditRows(database, "lab_tolerance_set")).toMatchObject([
      { outcome: "refused", reason_code: "test_retired" },
    ]);
  });

  it("refuses a prepared simulation with not_running, logged", async () => {
    const database = await createTestDb();
    db = database;
    const w = await world(database);
    const testId = await catalogueTest(database, "Creatinine (invented)");
    const result = await setTolerance(database, w.student, {
      labId: w.labId,
      testId,
      lower: "1",
      upper: "2",
    });
    expect(result).toEqual({ ok: false, error: "not_running" });
    expect(await auditRows(database, "lab_tolerance_set")).toMatchObject([
      { outcome: "refused", reason_code: "not_running", actor_id: w.student.id },
    ]);
    expect(await stored(database, w.labId)).toEqual([]);
  });

  it("refuses a finished simulation with not_running", async () => {
    const { database, w, testId } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    const result = await setTolerance(database, w.student, {
      labId: w.labId,
      testId,
      lower: "1",
      upper: "2",
    });
    expect(result).toEqual({ ok: false, error: "not_running" });
  });

  it("answers a student of another lab not_found, logged as a probe, and writes nothing", async () => {
    const { database, w, testId } = await open();
    const input = { labId: w.labId, testId, lower: "1", upper: "2" };
    let result: unknown;
    const lines = await securityLines(async () => {
      result = await setTolerance(database, w.otherLabStudent, input);
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(lines).toEqual([notFoundLine(w.otherLabStudent.id, "lab", w.labId)]);
    expect(await stored(database, w.labId)).toEqual([]);
    expect(await auditRows(database, "lab_tolerance_set")).toEqual([]);
  });

  it("answers a student of another simulation and a student in no lab not_found", async () => {
    const { database, w, testId } = await open();
    const input = { labId: w.labId, testId, lower: "1", upper: "2" };
    expect(await setTolerance(database, w.outsideStudent, input)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setTolerance(database, w.stranger, input)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await stored(database, w.labId)).toEqual([]);
  });

  it("answers a malformed lab id not_found, logged", async () => {
    const { database, w, testId } = await open();
    const lines = await securityLines(() =>
      setTolerance(database, w.student, { labId: "not-a-uuid", testId, lower: "1", upper: "2" }),
    );
    expect(lines).toHaveLength(1);
  });

  it("refuses a teacher of the simulation, an administrator and a teacher-admin with 403", async () => {
    const { database, w, testId } = await open();
    const input = { labId: w.labId, testId, lower: "1", upper: "2" };
    const both = await person(database, "teacher-admin", ["teacher", "admin"]);
    for (const actor of [w.teacher, w.coTeacher, w.outsiderTeacher, w.admin, both]) {
      await expect(setTolerance(database, actor, input)).rejects.toThrow(AuthError);
    }
    expect(await stored(database, w.labId)).toEqual([]);
  });
});
