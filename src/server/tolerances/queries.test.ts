// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a team's tolerances (S13, #269): a student reads only their own lab's, a teacher
// a lab of a simulation they teach, with every change; every other caller reads nothing (S10,
// D11, R-01).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW, notFoundLine, person, securityLines } from "../simulations/test-helpers.ts";
import { setTolerance } from "./actions.ts";
import { readStudentTolerances, readTeacherTolerances } from "./queries.ts";
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

describe("the student's tolerance page (S13)", () => {
  it("lists every active test with the lab's own current tolerance", async () => {
    const { database, w, testId } = await open();
    const other = await catalogueTest(database, "Albumin (invented)");
    await studentSets(database, w, testId, "4", "6");
    await studentSets(database, w, testId, "4.5", "6");
    const page = await readStudentTolerances(database, w.student, w.labId);
    expect(page).toMatchObject({
      labId: w.labId,
      labName: "Pipette Pilots",
      simulationName: "Practice simulation",
      state: "running",
    });
    expect(page?.tests.map((t) => [t.testId, t.lower, t.upper])).toEqual([
      [other, null, null],
      [testId, "4.5", "6"],
    ]);
  });

  it("never shows another lab's tolerance (S13: no other team sees them)", async () => {
    const { database, w, testId } = await open();
    await setTolerance(database, w.otherLabStudent, {
      labId: w.otherLabId,
      testId,
      lower: "1",
      upper: "9",
    });
    const page = await readStudentTolerances(database, w.student, w.labId);
    expect(page?.tests).toMatchObject([{ testId, lower: null, upper: null, setAt: null }]);
  });

  it("hides a retired test unless the lab has a tolerance for it", async () => {
    const { database, w, testId } = await open();
    const retired = await catalogueTest(database, "Old urea (invented)", { retired: true });
    await studentSets(database, w, testId, "4", "6");
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: NOW })
      .where("id", "=", testId)
      .execute();
    const page = await readStudentTolerances(database, w.student, w.labId);
    expect(page?.tests.map((t) => t.testId)).toEqual([testId]);
    expect(page?.tests.map((t) => t.testId)).not.toContain(retired);
  });

  it("stays readable after the simulation finished, with its state", async () => {
    const { database, w } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect((await readStudentTolerances(database, w.student, w.labId))?.state).toBe("finished");
  });

  it("reads nothing of another lab, another simulation or a malformed id, logged (R-01)", async () => {
    const { database, w } = await open();
    const reads: unknown[] = [];
    const lines = await securityLines(async () => {
      reads.push(await readStudentTolerances(database, w.otherLabStudent, w.labId));
      reads.push(await readStudentTolerances(database, w.outsideStudent, w.labId));
      reads.push(await readStudentTolerances(database, w.stranger, w.labId));
      reads.push(await readStudentTolerances(database, w.student, "not-a-uuid"));
    });
    expect(reads).toEqual([null, null, null, null]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual(notFoundLine(w.otherLabStudent.id, "lab", w.labId));
  });

  it("refuses a teacher and an administrator with 403", async () => {
    const { database, w } = await open();
    await expect(readStudentTolerances(database, w.teacher, w.labId)).rejects.toThrow(AuthError);
    await expect(readStudentTolerances(database, w.admin, w.labId)).rejects.toThrow(AuthError);
  });
});

describe("the teacher's view of a lab's tolerances (S13)", () => {
  it("gives the tolerance in force per test, and every change newest first, marked", async () => {
    const { database, w, testId } = await open();
    const albumin = await catalogueTest(database, "Albumin (invented)");
    await studentSets(database, w, testId, "4", "6");
    await studentSets(database, w, albumin, "30", "50");
    await studentSets(database, w, testId, "4.5", "6.5");
    const read = await readTeacherTolerances(database, w.coTeacher, w.labId);
    expect(read?.current.map((c) => [c.testName, c.lower, c.upper, c.current])).toEqual([
      ["Albumin (invented)", "30", "50", true],
      ["Creatinine (invented)", "4.5", "6.5", true],
    ]);
    expect(read?.changes.rows.map((c) => [c.testId, c.lower, c.current])).toEqual([
      [testId, "4.5", true],
      [albumin, "30", true],
      [testId, "4", false],
    ]);
    expect(read?.changes).toMatchObject({ page: 1, pages: 1, total: 3 });
  });

  it("pages the changes at 50 rows, newest first (review of #352, S2)", async () => {
    const { database, w, testId } = await open();
    const rows = Array.from({ length: 53 }, (_, n) => ({
      simulation_id: w.simulationId,
      lab_id: w.labId,
      test_id: testId,
      lower_limit: String(n),
      upper_limit: "100",
      set_at: new Date(NOW.getTime() + n * 1000),
    }));
    await database.insertInto("lab_tolerances").values(rows).execute();
    const first = await readTeacherTolerances(database, w.teacher, w.labId);
    expect(first?.changes.rows).toHaveLength(50);
    expect(first?.changes).toMatchObject({ page: 1, pages: 2, total: 53 });
    expect(first?.changes.rows[0]).toMatchObject({ lower: "52", current: true });
    expect(first?.current.map((c) => c.lower)).toEqual(["52"]);
    const second = await readTeacherTolerances(database, w.teacher, w.labId, 2);
    expect(second?.changes.rows.map((c) => c.lower)).toEqual(["2", "1", "0"]);
    expect(second?.changes.rows.every((c) => !c.current)).toBe(true);
  });

  it("holds only that lab's tolerances", async () => {
    const { database, w, testId } = await open();
    await setTolerance(database, w.otherLabStudent, {
      labId: w.otherLabId,
      testId,
      lower: "1",
      upper: "9",
    });
    expect(await readTeacherTolerances(database, w.teacher, w.labId)).toEqual({
      current: [],
      changes: { rows: [], page: 1, pages: 1, total: 0 },
    });
  });

  it("is read by a teacher-admin who teaches the simulation", async () => {
    const { database, w } = await open();
    const both = await person(database, "teacher-admin", ["teacher", "admin"]);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.simulationId, user_id: both.id, added_by: w.teacher.id })
      .execute();
    expect(await readTeacherTolerances(database, both, w.labId)).not.toBeNull();
  });

  it("refuses a former teacher whose row stayed but whose app role is now student", async () => {
    const { database, w } = await open();
    const former = await person(database, "former-teacher", ["student"]);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.simulationId, user_id: former.id, added_by: w.teacher.id })
      .execute();
    await expect(readTeacherTolerances(database, former, w.labId)).rejects.toThrow(AuthError);
  });

  it("reads nothing of another teacher's lab or a malformed id, logged (D11)", async () => {
    const { database, w } = await open();
    const reads: unknown[] = [];
    const lines = await securityLines(async () => {
      reads.push(await readTeacherTolerances(database, w.outsiderTeacher, w.labId));
      reads.push(await readTeacherTolerances(database, w.teacher, w.outsideLabId));
      reads.push(await readTeacherTolerances(database, w.teacher, "not-a-uuid"));
    });
    expect(reads).toEqual([null, null, null]);
    expect(lines).toEqual([
      notFoundLine(w.outsiderTeacher.id, "lab", w.labId),
      notFoundLine(w.teacher.id, "lab", w.outsideLabId),
      expect.objectContaining({ event: "authz_fail" }),
    ]);
  });

  it("refuses a student and an administrator with 403", async () => {
    const { database, w } = await open();
    await expect(readTeacherTolerances(database, w.student, w.labId)).rejects.toThrow(AuthError);
    await expect(readTeacherTolerances(database, w.admin, w.labId)).rejects.toThrow(AuthError);
  });
});
