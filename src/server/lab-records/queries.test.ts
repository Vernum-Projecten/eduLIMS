// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a team's records (S10, S11, S12): a member reads their lab's patients and
// requests in a stable order, and nobody else reads them; the teacher's correction log answers
// only a teacher of the simulation (D10, D11).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW, securityLines } from "../simulations/test-helpers.ts";
import { readCorrectionLog } from "./correction-log.ts";
import { correctPatient } from "./patients.ts";
import { listRequestableTests, readLabRecords } from "./queries.ts";
import { correctRequest } from "./requests.ts";
import { PATIENT, patientIn, recordsWorld, release, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await recordsWorld(db);
  const patientId = await patientIn(db, w.student, w.labId);
  const recorded = await requestFor(db, w.student, w.labId, patientId, [w.hba1c, w.crp]);
  return { db, w, patientId, recorded };
}

describe("readLabRecords (S10, S11, S12)", () => {
  it("returns the lab's patients and requests to every member alike", async () => {
    const { db: database, w, patientId, recorded } = await open();
    const records = await readLabRecords(database, w.labStudents[5] ?? w.student, w.labId);
    expect(records?.patients).toEqual([{ id: patientId, ...PATIENT, locked: false }]);
    expect(records?.requests).toEqual([
      {
        id: recorded.requestId,
        kind: "patient",
        patientId,
        requester: "Dr. Invented",
        phoneThrough: false,
        remarks: null,
        enteredAt: recorded.enteredAt,
        locked: false,
        tests: [
          { id: w.crp, name: "CRP (invented)", unit: "mmol/L" },
          { id: w.hba1c, name: "HbA1c (invented)", unit: "mmol/L" },
        ],
        notOffered: [],
        samples: recorded.samples.map((sample) => ({ ...sample, material: "whole blood" })),
      },
    ]);
  });

  it("says whether the simulation runs, and still reads once it finished (#267)", async () => {
    const { db: database, w } = await open();
    expect((await readLabRecords(database, w.student, w.labId))?.running).toBe(true);
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.running).toBe(false);
    expect(records?.patients).toHaveLength(1);
  });

  it("marks a patient and a request locked once a result is released", async () => {
    const { db: database, w, recorded } = await open();
    await release(database, recorded.requestId);
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.patients.map((patient) => patient.locked)).toEqual([true]);
    expect(records?.requests.map((request) => request.locked)).toEqual([true]);
  });

  it("lists requests newest first, by id within one time of entry", async () => {
    const { db: database, w, patientId, recorded } = await open();
    const second = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    const records = await readLabRecords(database, w.student, w.labId);
    const expected = [recorded.requestId, second.requestId].sort().reverse();
    expect(records?.requests.map((request) => request.id)).toEqual(expected);
  });

  it("gives another lab nothing of this lab, not even when it registered the same patient", async () => {
    const { db: database, w } = await open();
    await patientIn(database, w.otherLabStudent, w.otherLabId);
    const theirs = await readLabRecords(database, w.otherLabStudent, w.otherLabId);
    expect(theirs?.patients).toHaveLength(1);
    expect(theirs?.requests).toEqual([]);
    const lines = await securityLines(async () => {
      expect(await readLabRecords(database, w.otherLabStudent, w.labId)).toBeNull();
    });
    expect(lines).toEqual([expect.objectContaining({ target_type: "lab", target_id: w.labId })]);
  });

  it("answers null to a student outside the simulation, in no lab, or with a malformed id", async () => {
    const { db: database, w } = await open();
    expect(await readLabRecords(database, w.outsideStudent, w.labId)).toBeNull();
    expect(await readLabRecords(database, w.stranger, w.labId)).toBeNull();
    expect(await readLabRecords(database, w.student, "nope")).toBeNull();
  });

  it("refuses a teacher and an administrator with 403", async () => {
    const { db: database, w } = await open();
    for (const actor of [w.teacher, w.admin]) {
      await expect(readLabRecords(database, actor, w.labId)).rejects.toThrow(AuthError);
    }
  });
});

describe("listRequestableTests (D9, S12)", () => {
  it("lists the active tests by name, without a retired one", async () => {
    const { db: database, w } = await open();
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: new Date() })
      .where("id", "=", w.crp)
      .execute();
    expect(await listRequestableTests(database, w.student)).toEqual([
      { id: w.hba1c, name: "HbA1c (invented)", unit: "mmol/L", material: "plasma" },
    ]);
  });

  it("refuses a teacher with 403", async () => {
    const { db: database, w } = await open();
    await expect(listRequestableTests(database, w.teacher)).rejects.toThrow(AuthError);
  });
});

describe("readCorrectionLog (S11, S12, D10)", () => {
  it("shows the teachers of the simulation every correction, newest first", async () => {
    const { db: database, w, patientId } = await open();
    await correctPatient(database, w.student, {
      labId: w.labId,
      patientId,
      ...PATIENT,
      name: "Ada Corrected",
    });
    for (const teacher of [w.teacher, w.coTeacher]) {
      const log = await readCorrectionLog(database, teacher, w.simulationId);
      expect(log?.entries).toEqual([
        expect.objectContaining({
          labId: w.labId,
          labName: "Pipette Pilots",
          target: { kind: "patient", patientId, name: "Ada Corrected" },
          correctedBy: "Test student-1",
          changes: [{ field: "name", before: PATIENT.name, after: "Ada Corrected" }],
        }),
      ]);
      expect(log?.truncated).toBe(false);
    }
  });

  it("names the tests a correction of the tests changed", async () => {
    const { db: database, w, recorded } = await open();
    const urea = await catalogueTest(database, "Urea (invented)");
    await correctRequest(database, w.student, {
      labId: w.labId,
      requestId: recorded.requestId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c, w.crp, urea],
      samples: recorded.samples.map((sample) => ({
        sampleId: sample.id,
        sampleNumber: sample.sampleNumber,
        material: "whole blood",
      })),
    });
    const log = await readCorrectionLog(database, w.teacher, w.simulationId);
    expect(log?.testNames).toEqual({
      [w.hba1c]: "HbA1c (invented)",
      [w.crp]: "CRP (invented)",
      [urea]: "Urea (invented)",
    });
    // A request is named by the lab numbers of its samples (maintainer, 2026-11-20).
    expect(log?.entries.map((entry) => entry.target)).toEqual([
      {
        kind: "request",
        requestId: recorded.requestId,
        labNumbers: recorded.samples.map((sample) => sample.labNumber),
      },
    ]);
  });

  it("returns an empty log for a simulation without corrections", async () => {
    const { db: database, w } = await open();
    expect(await readCorrectionLog(database, w.teacher, w.simulationId)).toEqual({
      simulationId: w.simulationId,
      entries: [],
      truncated: false,
      testNames: {},
    });
  });

  it("answers null to a teacher of another simulation, logged (D11)", async () => {
    const { db: database, w } = await open();
    const lines = await securityLines(async () => {
      expect(await readCorrectionLog(database, w.outsiderTeacher, w.simulationId)).toBeNull();
    });
    expect(lines).toEqual([
      expect.objectContaining({ target_type: "simulation", target_id: w.simulationId }),
    ]);
    expect(await readCorrectionLog(database, w.teacher, "nope")).toBeNull();
  });

  it("refuses a student and an administrator with 403", async () => {
    const { db: database, w } = await open();
    for (const actor of [w.student, w.admin]) {
      await expect(readCorrectionLog(database, actor, w.simulationId)).rejects.toThrow(AuthError);
    }
  });
});
