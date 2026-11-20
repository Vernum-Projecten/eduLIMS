// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Registering and correcting a patient (S11) on a real database: stored as typed, within the
// student's own lab of a running simulation, correctable until the first release with a
// correction row for the teacher, and logged with ids only (E4). Every other caller is refused.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW, securityLines, world } from "../simulations/test-helpers.ts";
import { bornAfterToday, correctPatient, registerPatient } from "./patients.ts";
import { PATIENT, patientIn, recordsWorld, release, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return { db, w: await recordsWorld(db) };
}

function patients(database: Kysely<DB>) {
  return database
    .selectFrom("patients")
    .select(["lab_id", "name", "sex", "identifier", "created_by"])
    .orderBy("created_at")
    .execute();
}

function corrections(database: Kysely<DB>) {
  return database
    .selectFrom("record_corrections")
    .select(["lab_id", "patient_id", "request_id", "corrected_by", "changes"])
    .orderBy("corrected_at")
    .orderBy("id")
    .execute();
}

describe("registering a patient (S11)", () => {
  it("stores the details as typed, in the student's lab", async () => {
    const { db: database, w } = await open();
    const result = await registerPatient(database, w.student, { labId: w.labId, ...PATIENT });
    expect(result.ok).toBe(true);
    expect(await patients(database)).toEqual([
      {
        lab_id: w.labId,
        name: PATIENT.name,
        sex: PATIENT.sex,
        identifier: PATIENT.identifier,
        created_by: w.student.id,
      },
    ]);
  });

  it("returns the EHR subject #147 needs: the form's details and nothing about the lab", async () => {
    const { db: database, w } = await open();
    const result = await registerPatient(database, w.student, { labId: w.labId, ...PATIENT });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.ehr).toEqual({ patientId: result.value.patientId, ...PATIENT });
  });

  it("logs lab_patient_registered with ids only (E4)", async () => {
    const { db: database, w } = await open();
    const patientId = await patientIn(database, w.student, w.labId);
    const rows = await auditRows(database, "lab_patient_registered");
    expect(rows).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { patient_id: patientId },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(PATIENT.name);
  });

  it("lets two labs register the same patient, each as its own record (S10)", async () => {
    const { db: database, w } = await open();
    await patientIn(database, w.student, w.labId);
    await patientIn(database, w.otherLabStudent, w.otherLabId);
    expect((await patients(database)).map((row) => row.lab_id)).toEqual([w.labId, w.otherLabId]);
  });

  it("refuses a lab of another team as not_found and logs the probe (S10, R-01)", async () => {
    const { db: database, w } = await open();
    const lines = await securityLines(async () => {
      expect(
        await registerPatient(database, w.otherLabStudent, { labId: w.labId, ...PATIENT }),
      ).toEqual({ ok: false, error: "not_found" });
    });
    expect(lines).toEqual([
      expect.objectContaining({
        event: "authz_fail",
        actor_id: w.otherLabStudent.id,
        target_type: "lab",
        target_id: w.labId,
      }),
    ]);
    expect(await patients(database)).toEqual([]);
  });

  it("refuses a student outside the simulation and a student in no lab", async () => {
    const { db: database, w } = await open();
    for (const actor of [w.outsideStudent, w.stranger]) {
      expect(await registerPatient(database, actor, { labId: w.labId, ...PATIENT })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
    expect(await patients(database)).toEqual([]);
  });

  it("refuses a malformed lab id as not_found", async () => {
    const { db: database, w } = await open();
    expect(await registerPatient(database, w.student, { labId: "1 or 1=1", ...PATIENT })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses a teacher, a co-teacher and an administrator with 403", async () => {
    const { db: database, w } = await open();
    for (const actor of [w.teacher, w.coTeacher, w.admin]) {
      await expect(
        registerPatient(database, actor, { labId: w.labId, ...PATIENT }),
      ).rejects.toThrow(AuthError);
    }
    expect(await patients(database)).toEqual([]);
  });

  it("refuses a member while the simulation is prepared (not_running, #267)", async () => {
    const database = await createTestDb();
    db = database;
    const w = await world(database);
    expect(await registerPatient(database, w.student, { labId: w.labId, ...PATIENT })).toEqual({
      ok: false,
      error: "not_running",
    });
  });

  it("refuses a member after the simulation finished (not_running, #267)", async () => {
    const { db: database, w } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await registerPatient(database, w.student, { labId: w.labId, ...PATIENT })).toEqual({
      ok: false,
      error: "not_running",
    });
    expect(await patients(database)).toEqual([]);
  });
});

/** Returns today plus `days` in Europe/Amsterdam by the database clock, as `YYYY-MM-DD`. */
async function amsterdamDay(database: Kysely<DB>, days: number): Promise<string> {
  const result = await sql<{ day: string }>`
    select to_char((now() at time zone 'Europe/Amsterdam')::date + ${days}::int, 'YYYY-MM-DD')
      as day`.execute(database);
  const day = result.rows[0]?.day;
  if (day === undefined) throw new Error("no day");
  return day;
}

describe("a date of birth after today (S11; maintainer, 2026-11-20 on #268)", () => {
  it("takes today and yesterday in Europe/Amsterdam, and refuses tomorrow", async () => {
    const { db: database, w } = await open();
    const register = async (days: number) =>
      registerPatient(database, w.student, {
        labId: w.labId,
        ...PATIENT,
        dateOfBirth: await amsterdamDay(database, days),
      });
    expect((await register(-1)).ok).toBe(true);
    expect((await register(0)).ok).toBe(true);
    expect(await register(1)).toEqual({ ok: false, error: "birth_in_future" });
    expect(await patients(database)).toHaveLength(2);
  });

  it("agrees with the day in Europe/Amsterdam on both sides of today", async () => {
    const { db: database } = await open();
    const amsterdam = await amsterdamDay(database, 0);
    expect(await bornAfterToday(database, amsterdam)).toBe(false);
    const tomorrow = await amsterdamDay(database, 1);
    expect(await bornAfterToday(database, tomorrow)).toBe(true);
  });

  it("refuses a correction to a date after today, and changes nothing", async () => {
    const { db: database, w } = await open();
    const patientId = await patientIn(database, w.student, w.labId);
    expect(
      await correctPatient(database, w.student, {
        labId: w.labId,
        patientId,
        ...PATIENT,
        dateOfBirth: await amsterdamDay(database, 1),
      }),
    ).toEqual({ ok: false, error: "birth_in_future" });
    expect(
      await correctPatient(database, w.student, {
        labId: w.labId,
        patientId,
        ...PATIENT,
        dateOfBirth: await amsterdamDay(database, 0),
      }),
    ).toEqual({ ok: true, value: { changed: 1 } });
  });
});

describe("correcting a patient (S11)", () => {
  async function registered() {
    const opened = await open();
    const patientId = await patientIn(opened.db, opened.w.student, opened.w.labId);
    return { ...opened, patientId };
  }

  it("changes the fields that differ and writes one correction row for the teacher", async () => {
    const { db: database, w, patientId } = await registered();
    const result = await correctPatient(database, w.labStudents[1] ?? w.student, {
      labId: w.labId,
      patientId,
      ...PATIENT,
      name: "Ada Testpatiënt",
      dateOfBirth: "1984-03-12",
    });
    expect(result).toEqual({ ok: true, value: { changed: 2 } });
    expect(await corrections(database)).toEqual([
      {
        lab_id: w.labId,
        patient_id: patientId,
        request_id: null,
        corrected_by: w.labStudents[1]?.id,
        changes: [
          { field: "name", before: PATIENT.name, after: "Ada Testpatiënt" },
          { field: "date_of_birth", before: "1984-03-21", after: "1984-03-12" },
        ],
      },
    ]);
    const audit = await auditRows(database, "lab_patient_corrected");
    expect(audit).toEqual([expect.objectContaining({ metadata: { patient_id: patientId } })]);
    expect(JSON.stringify(audit)).not.toContain("Ada");
  });

  it("writes nothing for a correction that changes nothing", async () => {
    const { db: database, w, patientId } = await registered();
    expect(
      await correctPatient(database, w.student, { labId: w.labId, patientId, ...PATIENT }),
    ).toEqual({ ok: true, value: { changed: 0 } });
    expect(await corrections(database)).toEqual([]);
    expect(await auditRows(database, "lab_patient_corrected")).toEqual([]);
  });

  it("is refused once a result of one of its requests is released, and logged", async () => {
    const { db: database, w, patientId } = await registered();
    const request = await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    await release(database, request.requestId);
    expect(
      await correctPatient(database, w.student, {
        labId: w.labId,
        patientId,
        ...PATIENT,
        name: "Changed",
      }),
    ).toEqual({ ok: false, error: "released" });
    expect(await auditRows(database, "lab_patient_corrected")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "released" }),
    ]);
    expect((await patients(database))[0]?.name).toBe(PATIENT.name);
  });

  it("is allowed while its requests have no released result", async () => {
    const { db: database, w, patientId } = await registered();
    await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    expect(
      await correctPatient(database, w.student, {
        labId: w.labId,
        patientId,
        ...PATIENT,
        sex: "unknown",
      }),
    ).toEqual({ ok: true, value: { changed: 1 } });
  });

  it("refuses a patient of another lab as patient_not_found, changing nothing", async () => {
    const { db: database, w, patientId } = await registered();
    const lines = await securityLines(async () => {
      expect(
        await correctPatient(database, w.otherLabStudent, {
          labId: w.otherLabId,
          patientId,
          ...PATIENT,
          name: "Hijacked",
        }),
      ).toEqual({ ok: false, error: "patient_not_found" });
    });
    expect(lines).toEqual([
      expect.objectContaining({ target_type: "patient", target_id: patientId }),
    ]);
    expect((await patients(database))[0]?.name).toBe(PATIENT.name);
  });

  it("refuses the other lab's student on the patient's own lab as not_found", async () => {
    const { db: database, w, patientId } = await registered();
    expect(
      await correctPatient(database, w.otherLabStudent, {
        labId: w.labId,
        patientId,
        ...PATIENT,
        name: "Hijacked",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a teacher and an administrator with 403", async () => {
    const { db: database, w, patientId } = await registered();
    for (const actor of [w.teacher, w.admin]) {
      await expect(
        correctPatient(database, actor, { labId: w.labId, patientId, ...PATIENT, name: "X" }),
      ).rejects.toThrow(AuthError);
    }
  });
});
