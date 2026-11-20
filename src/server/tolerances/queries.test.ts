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
import { NOW, notFoundLine, securityLines } from "../simulations/test-helpers.ts";
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
  it("lists every change by test, newest first, with the one in force marked", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    await studentSets(database, w, testId, "4.5", "6.5");
    const changes = await readTeacherTolerances(database, w.coTeacher, w.labId);
    expect(changes?.map((c) => [c.testId, c.lower, c.upper, c.current])).toEqual([
      [testId, "4.5", "6.5", true],
      [testId, "4", "6", false],
    ]);
    expect(changes?.[0]?.testName).toBe("Creatinine (invented)");
  });

  it("holds only that lab's tolerances", async () => {
    const { database, w, testId } = await open();
    await setTolerance(database, w.otherLabStudent, {
      labId: w.otherLabId,
      testId,
      lower: "1",
      upper: "9",
    });
    expect(await readTeacherTolerances(database, w.teacher, w.labId)).toEqual([]);
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
