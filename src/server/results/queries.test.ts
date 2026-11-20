// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a lab's measurements and results (S14, S15, D11) on a real database: the team sees
// every measurement and its own tolerance and nothing of a teacher (Q-SIM-1); a teacher of the
// simulation sees every measurement with the released one marked; everyone else gets nothing.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { SECRET_RED, SECRET_VALUE, SECRET_YELLOW } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { notFoundLine, securityLines } from "../simulations/test-helpers.ts";
import { readStudentResults, readTeacherResults } from "./queries.ts";
import { releaseResult } from "./release.ts";
import { measure, resultsWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  const w = await resultsWorld(database);
  const first = await measure(database, w, "5.1");
  const second = await measure(database, w, "6.4", { sampleId: w.second.id });
  const released = await releaseResult(database, w.student, {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    measurementId: second,
    toleranceId: w.toleranceId,
  });
  if (!released.ok) throw new Error(released.error);
  return { database, w, first, second };
}

describe("the student's results page (S14, S15)", () => {
  it("lists every measurement of a requested test, oldest first, with the released one marked", async () => {
    const { database, w, first, second } = await open();
    const page = await readStudentResults(database, w.student, w.labId);
    const request = page?.requests[0];
    expect(page?.running).toBe(true);
    expect(request).toMatchObject({ id: w.requestId, kind: "patient", patientId: w.patientId });
    const hba1c = request?.tests.find((test) => test.testId === w.hba1c);
    expect(hba1c?.state).toBe("released");
    expect(hba1c?.measurements.map((row) => [row.id, row.value, row.released])).toEqual([
      [first, "5.1", false],
      [second, "6.4", true],
    ]);
    expect(hba1c?.measurements[1]?.labNumber).toBe(w.second.labNumber);
    expect(hba1c?.release).toMatchObject({
      measurementId: second,
      tolerance: { lower: "4.0", upper: "6.0" },
    });
    expect(hba1c?.tolerance).toEqual({ id: w.toleranceId, lower: "4.0", upper: "6.0" });
    const crp = request?.tests.find((test) => test.testId === w.crp);
    expect(crp).toMatchObject({ state: "requested", tolerance: null, release: null });
    expect(crp?.measurements).toEqual([]);
  });

  it("holds no correct value and no accuracy limit of the simulation (Q-SIM-1)", async () => {
    const { database, w } = await open();
    await database
      .insertInto("simulation_test_limits")
      .values({
        simulation_id: w.simulationId,
        test_id: w.hba1c,
        kind: "absolute",
        yellow_limit: SECRET_YELLOW,
        red_limit: SECRET_RED,
      })
      .execute();
    await database
      .insertInto("correct_values")
      .values({
        simulation_id: w.simulationId,
        test_id: w.hba1c,
        sample_number: "S-001",
        value: SECRET_VALUE,
      })
      .execute();
    const text = JSON.stringify(await readStudentResults(database, w.student, w.labId));
    for (const secret of [SECRET_VALUE, SECRET_YELLOW, SECRET_RED]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/accuracy|correct|yellow|red_limit|green/i);
  });

  it("answers another lab's student, a student outside the simulation and a malformed id with null, logged", async () => {
    const { database, w } = await open();
    for (const actor of [w.otherLabStudent, w.outsideStudent, w.stranger]) {
      const lines = await securityLines(async () => {
        expect(await readStudentResults(database, actor, w.labId)).toBeNull();
      });
      expect(lines).toContainEqual(notFoundLine(actor.id, "lab", w.labId));
    }
    expect(await readStudentResults(database, w.student, "nope")).toBeNull();
  });

  it("shows another lab's student only their own, empty lab", async () => {
    const { database, w } = await open();
    const page = await readStudentResults(database, w.otherLabStudent, w.otherLabId);
    expect(page?.requests).toEqual([]);
  });

  it("refuses a teacher and an administrator with a 403", async () => {
    const { database, w } = await open();
    for (const actor of [w.teacher, w.admin]) {
      await expect(readStudentResults(database, actor, w.labId)).rejects.toThrow(AuthError);
    }
  });
});

describe("the teacher's view of a lab's results (D11)", () => {
  it("shows a teacher and a co-teacher every measurement with the released one marked", async () => {
    const { database, w, first, second } = await open();
    for (const actor of [w.teacher, w.coTeacher]) {
      const page = await readTeacherResults(database, actor, w.labId);
      const hba1c = page?.requests[0]?.tests.find((test) => test.testId === w.hba1c);
      expect(hba1c?.measurements.map((row) => [row.id, row.released])).toEqual([
        [first, false],
        [second, true],
      ]);
      expect(hba1c?.release?.releasedAt).toEqual(expect.any(String));
    }
  });

  it("answers a teacher of another simulation and a malformed id with null, logged", async () => {
    const { database, w } = await open();
    const lines = await securityLines(async () => {
      expect(await readTeacherResults(database, w.outsiderTeacher, w.labId)).toBeNull();
    });
    expect(lines).toContainEqual(notFoundLine(w.outsiderTeacher.id, "lab", w.labId));
    expect(await readTeacherResults(database, w.teacher, "nope")).toBeNull();
  });

  it("refuses a student and an administrator with a 403", async () => {
    const { database, w } = await open();
    for (const actor of [w.student, w.admin]) {
      await expect(readTeacherResults(database, actor, w.labId)).rejects.toThrow(AuthError);
    }
  });
});
