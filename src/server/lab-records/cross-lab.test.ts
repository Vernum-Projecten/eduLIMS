// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A student in labs of two running simulations (S10, R-01; security review of #351): sending
// lab A with a patient, request or sample id of their own lab B is refused as not found, because
// every record is reached through the lab named in the same query. The correction log of one
// simulation never shows a correction of another (D10, D11).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { startSimulation } from "../simulations/state.ts";
import { NOW, place } from "../simulations/test-helpers.ts";
import { readCorrectionLog } from "./correction-log.ts";
import { correctPatient } from "./patients.ts";
import { correctRequest } from "./requests.ts";
import { PATIENT, patientIn, recordsWorld, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** The student in lab A of the first simulation and lab B of the second, with records in both. */
async function open() {
  const database = await createTestDb();
  db = database;
  const w = await recordsWorld(database);
  const started = await startSimulation(
    database,
    w.outsiderTeacher,
    { simulationId: w.outsideSimulationId },
    NOW,
  );
  if (!started.ok) throw new Error(started.error);
  await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
  const patientA = await patientIn(database, w.student, w.labId);
  const requestA = await requestFor(database, w.student, w.labId, patientA, [w.hba1c]);
  const patientB = await patientIn(database, w.student, w.outsideLabId);
  const requestB = await requestFor(database, w.student, w.outsideLabId, patientB, [w.hba1c]);
  return { database, w, patientA, requestA, patientB, requestB };
}

function sampleOf(request: { samples: { id: string }[] }): string {
  const id = request.samples[0]?.id;
  if (id === undefined) throw new Error("no sample");
  return id;
}

describe("ids of the student's other lab (S10, R-01)", () => {
  it("refuses lab A with a patient of lab B as patient_not_found", async () => {
    const { database, w, patientB } = await open();
    expect(
      await correctPatient(database, w.student, {
        labId: w.labId,
        patientId: patientB,
        ...PATIENT,
        name: "Crossed",
      }),
    ).toEqual({ ok: false, error: "patient_not_found" });
    await expect(requestFor(database, w.student, w.labId, patientB, [w.hba1c])).rejects.toThrow(
      "patient_not_found",
    );
  });

  it("refuses lab A with a request of lab B as request_not_found", async () => {
    const { database, w, requestB } = await open();
    expect(
      await correctRequest(database, w.student, {
        labId: w.labId,
        requestId: requestB.requestId,
        requester: "Crossed",
        phoneThrough: false,
        remarks: null,
        testIds: [w.hba1c],
        samples: [{ sampleNumber: "S-001", material: "whole blood" }],
      }),
    ).toEqual({ ok: false, error: "request_not_found" });
  });

  it("refuses a request of lab A with a sample of lab B as sample_not_found", async () => {
    const { database, w, requestA, requestB } = await open();
    expect(
      await correctRequest(database, w.student, {
        labId: w.labId,
        requestId: requestA.requestId,
        requester: "Dr. Invented",
        phoneThrough: false,
        remarks: null,
        testIds: [w.hba1c],
        samples: [{ sampleId: sampleOf(requestB), sampleNumber: "S-X", material: "plasma" }],
      }),
    ).toEqual({ ok: false, error: "sample_not_found" });
    const sampleB = await database
      .selectFrom("samples")
      .select("sample_number")
      .where("id", "=", sampleOf(requestB))
      .executeTakeFirstOrThrow();
    expect(sampleB.sample_number).toBe("S-001");
  });
});

describe("the correction log across simulations (D10, D11)", () => {
  it("shows a correction only to the teachers of its own simulation", async () => {
    const { database, w, patientB } = await open();
    await correctPatient(database, w.student, {
      labId: w.outsideLabId,
      patientId: patientB,
      ...PATIENT,
      name: "Corrected in B",
    });
    expect((await readCorrectionLog(database, w.teacher, w.simulationId))?.entries).toEqual([]);
    const theirs = await readCorrectionLog(database, w.outsiderTeacher, w.outsideSimulationId);
    expect(theirs?.entries.map((entry) => entry.labId)).toEqual([w.outsideLabId]);
  });
});
