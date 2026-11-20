// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Recording a request (S12, S16) on a real database: the request, its tests and its samples in
// one transaction, the time of entry from the database clock, a lab number per sample unique
// across the teams, a control request without a patient, and the refusals of every other caller.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { isLabNumber } from "../../lib/lab-number.ts";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { auditRows, securityLines } from "../simulations/test-helpers.ts";
import { recordRequest } from "./requests.ts";
import { patientIn, recordsWorld, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await recordsWorld(db);
  const patientId = await patientIn(db, w.student, w.labId);
  return { db, w, patientId };
}

function requestRows(database: Kysely<DB>) {
  return database
    .selectFrom("requests")
    .select(["lab_id", "kind", "patient_id", "requester", "phone_through", "remarks"])
    .orderBy("entered_at")
    .orderBy("id")
    .execute();
}

describe("recording a request for a patient (S12)", () => {
  it("stores the request as typed, with its tests and its samples", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c, w.crp], {
      phoneThrough: true,
      remarks: "Fasting sample.",
      samples: [
        { sampleNumber: "S-001", material: "whole blood" },
        { sampleNumber: "S-002", material: "plasma" },
      ],
    });
    expect(await requestRows(database)).toEqual([
      {
        lab_id: w.labId,
        kind: "patient",
        patient_id: patientId,
        requester: "Dr. Invented",
        phone_through: true,
        remarks: "Fasting sample.",
      },
    ]);
    const tests = await database
      .selectFrom("request_tests")
      .select(["test_id", "released_at"])
      .where("request_id", "=", recorded.requestId)
      .orderBy("test_id")
      .execute();
    expect(tests).toEqual(
      [w.hba1c, w.crp].sort().map((testId) => ({ test_id: testId, released_at: null })),
    );
    expect(recorded.samples.map((sample) => sample.sampleNumber)).toEqual(["S-001", "S-002"]);
  });

  it("gives each sample a ten-digit lab number with a valid check digit (S12)", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    for (const sample of recorded.samples) expect(isLabNumber(sample.labNumber)).toBe(true);
  });

  it("takes the time of entry from the database clock of the storing transaction (Q-SIM-2)", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    const clock = await sql<{ now: Date }>`select now() as now`.execute(database);
    expect(recorded.enteredAt).toBe(clock.rows[0]?.now.toISOString());
  });

  it("ignores a time of entry a caller smuggles into the insert (Q-SIM-2)", async () => {
    const { db: database, w } = await open();
    await database
      .insertInto("requests")
      .values({
        simulation_id: w.simulationId,
        lab_id: w.labId,
        kind: "control",
        entered_at: new Date("2000-01-01T00:00:00Z"),
      })
      .execute();
    const row = await database
      .selectFrom("requests")
      .select(sql<boolean>`entered_at = now()`.as("server_time"))
      .executeTakeFirstOrThrow();
    expect(row.server_time).toBe(true);
  });

  it("gives two teams that record the same sample number different lab numbers (S12)", async () => {
    const { db: database, w, patientId } = await open();
    const other = await patientIn(database, w.otherLabStudent, w.otherLabId);
    const mine = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    const theirs = await requestFor(database, w.otherLabStudent, w.otherLabId, other, [w.hba1c]);
    expect(mine.samples[0]?.sampleNumber).toBe(theirs.samples[0]?.sampleNumber);
    expect(mine.samples[0]?.labNumber).not.toBe(theirs.samples[0]?.labNumber);
  });

  it("allows the same sample number twice in one lab, told apart by the lab numbers (S12)", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c], {
      samples: [
        { sampleNumber: "S-001", material: "whole blood" },
        { sampleNumber: "S-001", material: "whole blood" },
      ],
    });
    const [first, second] = recorded.samples;
    expect(first?.sampleNumber).toBe(second?.sampleNumber);
    expect(first?.labNumber).not.toBe(second?.labNumber);
  });

  it("logs lab_request_recorded with the request's id and the number of samples (E4)", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    const rows = await auditRows(database, "lab_request_recorded");
    expect(rows).toEqual([
      expect.objectContaining({
        actor_id: w.student.id,
        target_id: w.labId,
        metadata: { lab_request_id: recorded.requestId, count: 1 },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(recorded.samples[0]?.labNumber ?? "-");
  });

  it("refuses a patient of another lab as patient_not_found and stores nothing", async () => {
    const { db: database, w, patientId } = await open();
    const lines = await securityLines(async () => {
      await expect(
        requestFor(database, w.otherLabStudent, w.otherLabId, patientId, [w.hba1c]),
      ).rejects.toThrow("patient_not_found");
    });
    expect(lines).toEqual([
      expect.objectContaining({ target_type: "patient", target_id: patientId }),
    ]);
    expect(await requestRows(database)).toEqual([]);
  });

  it("refuses an unknown test and a retired test, storing nothing (D9)", async () => {
    const { db: database, w, patientId } = await open();
    const retired = await catalogueTest(database, "Retired (invented)", { retired: true });
    await expect(
      requestFor(database, w.student, w.labId, patientId, [crypto.randomUUID()]),
    ).rejects.toThrow("test_not_found");
    await expect(
      requestFor(database, w.student, w.labId, patientId, [w.hba1c, retired]),
    ).rejects.toThrow("test_retired");
    expect(await requestRows(database)).toEqual([]);
  });

  it("refuses the request of another team's lab as not_found (S10, R-01)", async () => {
    const { db: database, w, patientId } = await open();
    for (const actor of [w.otherLabStudent, w.outsideStudent, w.stranger]) {
      await expect(requestFor(database, actor, w.labId, patientId, [w.hba1c])).rejects.toThrow(
        "not_found",
      );
    }
    expect(await requestRows(database)).toEqual([]);
  });

  it("refuses a teacher and an administrator with 403", async () => {
    const { db: database, w, patientId } = await open();
    for (const actor of [w.teacher, w.coTeacher, w.outsiderTeacher, w.admin]) {
      await expect(requestFor(database, actor, w.labId, patientId, [w.hba1c])).rejects.toThrow(
        AuthError,
      );
    }
  });
});

describe("recording a control request (S16)", () => {
  it("stores it without a patient, with a lab number per sample", async () => {
    const { db: database, w } = await open();
    const result = await recordRequest(database, w.student, {
      kind: "control",
      labId: w.labId,
      requester: null,
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c],
      samples: [{ sampleNumber: "QC-LOW", material: "control material" }],
    });
    if (!result.ok) throw new Error(result.error);
    expect(isLabNumber(result.value.samples[0]?.labNumber ?? "")).toBe(true);
    expect(await requestRows(database)).toEqual([
      {
        lab_id: w.labId,
        kind: "control",
        patient_id: null,
        requester: null,
        phone_through: false,
        remarks: null,
      },
    ]);
  });
});

describe("the database rules of the records (E5)", () => {
  it("refuses a patient request without a patient and a control request with one", async () => {
    const { db: database, w, patientId } = await open();
    const insert = (kind: string, patient: string | null) =>
      database.transaction().execute((trx) =>
        trx
          .insertInto("requests")
          .values({
            simulation_id: w.simulationId,
            lab_id: w.labId,
            kind,
            patient_id: patient,
            requester: "Dr. Invented",
          })
          .execute(),
      );
    await expect(insert("patient", null)).rejects.toThrow(/requests_patient/);
    await expect(insert("control", patientId)).rejects.toThrow(/requests_patient/);
  });

  it("refuses a request that names the patient of another lab", async () => {
    const { db: database, w, patientId } = await open();
    await expect(
      database.transaction().execute((trx) =>
        trx
          .insertInto("requests")
          .values({
            simulation_id: w.simulationId,
            lab_id: w.otherLabId,
            kind: "patient",
            patient_id: patientId,
            requester: "Dr. Invented",
          })
          .execute(),
      ),
    ).rejects.toThrow(/requests_patient_fkey/);
  });

  it("refuses a change of the time of entry (S12)", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    await expect(
      database.transaction().execute((trx) =>
        trx
          .updateTable("requests")
          .set({ entered_at: new Date("2000-01-01T00:00:00Z") })
          .where("id", "=", recorded.requestId)
          .execute(),
      ),
    ).rejects.toThrow(/time of entry/);
  });

  it("refuses a lab number twice and a lab number with a wrong check digit", async () => {
    const { db: database, w, patientId } = await open();
    const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    const labNumber = recorded.samples[0]?.labNumber ?? "";
    const insert = (value: string) =>
      database.transaction().execute((trx) =>
        trx
          .insertInto("samples")
          .values({
            simulation_id: w.simulationId,
            lab_id: w.labId,
            request_id: recorded.requestId,
            sample_number: "S-002",
            material: "plasma",
            lab_number: value,
          })
          .execute(),
      );
    await expect(insert(labNumber)).rejects.toThrow(/samples_lab_number_key/);
    const wrong = `${labNumber.slice(0, 9)}${(Number(labNumber.at(9)) + 1) % 10}`;
    await expect(insert(wrong)).rejects.toThrow(/samples_lab_number/);
  });
});
