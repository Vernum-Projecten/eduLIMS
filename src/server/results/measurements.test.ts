// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements of a requested test (S14, #270) on a real database: a second measurement is kept
// beside the first, the server takes the time, a value is parsed and bounded before it is stored,
// and only a member of the lab enters one by hand, only for a hand-entered test, before the release.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { patientIn, requestFor } from "../lab-records/test-helpers.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import {
  auditRows,
  NOW,
  notFoundLine,
  person,
  place,
  securityLines,
  setState,
} from "../simulations/test-helpers.ts";
import { insertMeasurement, type NewMeasurement, recordManualMeasurement } from "./measurements.ts";
import { releaseResult } from "./release.ts";
import { measure, type ResultsWorld, resultsWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  return { database, w: await resultsWorld(database) };
}

function input(w: ResultsWorld, value = "5.2") {
  return {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    sampleId: w.first.id,
    value,
  };
}

function stored(database: Kysely<DB>, requestId: string) {
  return database
    .selectFrom("measurements")
    .select(["test_id", "sample_id", sql<string>`value::text`.as("value"), "source", "recorded_by"])
    .where("request_id", "=", requestId)
    .orderBy("recorded_at")
    .orderBy("id")
    .execute();
}

describe("recording a measurement by hand (S14)", () => {
  it("stores the value as a decimal with its sample and the student who entered it", async () => {
    const { database, w } = await open();
    await measure(database, w, "5,20");
    expect(await stored(database, w.requestId)).toEqual([
      {
        test_id: w.hba1c,
        sample_id: w.first.id,
        value: "5.20",
        source: "manual",
        recorded_by: w.student.id,
      },
    ]);
  });

  it("keeps a second measurement of the same test and sample beside the first (S14)", async () => {
    const { database, w } = await open();
    await measure(database, w, "5.2");
    const classmate = w.labStudents[1];
    if (!classmate) throw new Error("no classmate");
    const again = await recordManualMeasurement(database, classmate, input(w, "5.4"));
    expect(again.ok).toBe(true);
    expect((await stored(database, w.requestId)).map((row) => row.value)).toEqual(["5.2", "5.4"]);
  });

  it("takes the time from the database clock, never from the request (Q-SIM-2)", async () => {
    const { database, w } = await open();
    const before = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(database);
    const crafted = { ...input(w), recordedAt: "2000-01-01T00:00:00Z" };
    const result = await recordManualMeasurement(database, w.student, crafted);
    if (!result.ok) throw new Error(result.error);
    const start = before.rows[0]?.now ?? new Date(0);
    expect(new Date(result.value.recordedAt).getTime()).toBeGreaterThanOrEqual(start.getTime());
  });

  it("logs the ids of the measurement, never its value (E4)", async () => {
    const { database, w } = await open();
    const id = await measure(database, w, "5.2");
    const rows = await auditRows(database, "lab_measurement_recorded");
    expect(rows).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { lab_request_id: w.requestId, test_id: w.hba1c, measurement_id: id },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("5.2");
  });

  it("refuses a test whose measurements come from an analyser (D9)", async () => {
    const { database, w } = await open();
    await database
      .updateTable("catalogue_tests")
      .set({ source: "afinion", afinion_analyte: "CRP" })
      .where("id", "=", w.crp)
      .execute();
    expect(
      await recordManualMeasurement(database, w.student, { ...input(w), testId: w.crp }),
    ).toEqual({ ok: false, error: "not_manual_test" });
  });

  it("refuses a test the request does not name", async () => {
    const { database, w } = await open();
    const other = await database
      .insertInto("catalogue_tests")
      .values({ name: "Urea (invented)", unit: "mmol/L", material: "plasma", source: "manual" })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(
      await recordManualMeasurement(database, w.student, { ...input(w), testId: other.id }),
    ).toEqual({ ok: false, error: "test_not_found" });
  });

  it("refuses a sample of another request of the lab, logged", async () => {
    const { database, w } = await open();
    const other = await requestFor(database, w.student, w.labId, w.patientId, [w.hba1c]);
    const sampleId = other.samples[0]?.id ?? "";
    const lines = await securityLines(async () => {
      expect(await recordManualMeasurement(database, w.student, { ...input(w), sampleId })).toEqual(
        { ok: false, error: "sample_not_found" },
      );
    });
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "authz_fail", target_type: "sample", target_id: sampleId }),
    );
  });

  it("refuses a measurement after the release (S15)", async () => {
    const { database, w } = await open();
    const id = await measure(database, w, "5.2");
    const released = await releaseResult(database, w.student, {
      labId: w.labId,
      requestId: w.requestId,
      testId: w.hba1c,
      measurementId: id,
      toleranceId: w.toleranceId,
    });
    expect(released.ok).toBe(true);
    expect(await recordManualMeasurement(database, w.student, input(w, "5.3"))).toEqual({
      ok: false,
      error: "released",
    });
  });

  it("refuses work in a simulation that does not run (D10)", async () => {
    const { database, w } = await open();
    const finished = await finishSimulation(
      database,
      w.teacher,
      { simulationId: w.simulationId },
      NOW,
    );
    expect(finished.ok).toBe(true);
    expect(await recordManualMeasurement(database, w.student, input(w))).toEqual({
      ok: false,
      error: "not_running",
    });
  });
});

/** Makes the world's CRP an Afinion 2 test, as the catalogue would hold it (test set-up only). */
async function afinionCrp(database: Kysely<DB>, w: ResultsWorld): Promise<void> {
  await database
    .updateTable("catalogue_tests")
    .set({ source: "afinion", afinion_analyte: "CRP" })
    .where("id", "=", w.crp)
    .execute();
}

/** Runs the seam in its own transaction, as an analyser route would. */
function seam(database: Kysely<DB>, w: ResultsWorld, overrides: Partial<NewMeasurement> = {}) {
  return database.transaction().execute((trx) =>
    insertMeasurement(trx, {
      labId: w.labId,
      requestId: w.requestId,
      testId: w.crp,
      sampleId: w.second.id,
      value: "12.5",
      source: "afinion",
      recordedBy: null,
      ...overrides,
    }),
  );
}

function refusals(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["actor_type", "reason_code"])
    .where("action", "=", "lab_measurement_recorded")
    .where("outcome", "=", "refused")
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

describe("a value is parsed and bounded before it is stored", () => {
  for (const value of [
    "1e5",
    "1.5E+01",
    "1234567890",
    "1.1234567",
    "",
    "five",
    "NaN",
    "Infinity",
  ]) {
    it(`refuses ${JSON.stringify(value)} with value_invalid, logged, and stores nothing`, async () => {
      const { database, w } = await open();
      await afinionCrp(database, w);
      expect(await seam(database, w, { value })).toEqual({ ok: false, error: "value_invalid" });
      expect(await stored(database, w.requestId)).toEqual([]);
      expect(await refusals(database)).toEqual([
        { actor_type: "system", reason_code: "value_invalid" },
      ]);
    });
  }
});

describe("the seam of the analyser routes (security review of #370, S3)", () => {
  it("stores an analyser's measurement with no student and a system actor", async () => {
    const { database, w } = await open();
    await afinionCrp(database, w);
    const result = await seam(database, w, { value: "123456789.123456" });
    expect(result.ok).toBe(true);
    expect(await stored(database, w.requestId)).toMatchObject([
      { value: "123456789.123456", source: "afinion", recorded_by: null },
    ]);
    const rows = await database
      .selectFrom("audit_event")
      .select(["actor_type", "actor_id"])
      .where("action", "=", "lab_measurement_recorded")
      .execute();
    expect(rows).toEqual([{ actor_type: "system", actor_id: null }]);
  });

  it("refuses a measurement whose source is not the test's own, logged (D9)", async () => {
    const { database, w } = await open();
    expect(await seam(database, w)).toEqual({ ok: false, error: "source_mismatch" });
    await afinionCrp(database, w);
    expect(await seam(database, w, { source: "epoch_upload" })).toEqual({
      ok: false,
      error: "source_mismatch",
    });
    expect(await stored(database, w.requestId)).toEqual([]);
    expect((await refusals(database)).map((row) => row.reason_code)).toEqual([
      "source_mismatch",
      "source_mismatch",
    ]);
  });

  it("refuses a result for a lab whose simulation does not run, logged (maintainer on #270)", async () => {
    const { database, w } = await open();
    await afinionCrp(database, w);
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await seam(database, w)).toEqual({ ok: false, error: "not_running" });
    expect(await stored(database, w.requestId)).toEqual([]);
    expect(await refusals(database)).toEqual([
      { actor_type: "system", reason_code: "not_running" },
    ]);
  });

  it("lets an analyser result land after the release; the release stays final (maintainer on #370, Q1)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.2");
    const released = await releaseResult(database, w.student, {
      labId: w.labId,
      requestId: w.requestId,
      testId: w.hba1c,
      measurementId: chosen,
      toleranceId: w.toleranceId,
    });
    expect(released.ok).toBe(true);
    await database
      .updateTable("catalogue_tests")
      .set({ source: "afinion", afinion_analyte: "HbA1c" })
      .where("id", "=", w.hba1c)
      .execute();
    expect((await seam(database, w, { testId: w.hba1c, value: "5.9" })).ok).toBe(true);
    const row = await database
      .selectFrom("request_tests")
      .select("released_measurement_id")
      .where("request_id", "=", w.requestId)
      .where("test_id", "=", w.hba1c)
      .executeTakeFirstOrThrow();
    expect(row.released_measurement_id).toBe(chosen);
  });

  it("refuses a hand-entered measurement on a released test through the seam too, logged", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.2");
    await releaseResult(database, w.student, {
      labId: w.labId,
      requestId: w.requestId,
      testId: w.hba1c,
      measurementId: chosen,
      toleranceId: w.toleranceId,
    });
    expect(
      await seam(database, w, {
        testId: w.hba1c,
        sampleId: w.first.id,
        source: "manual",
        recordedBy: w.student.id,
      }),
    ).toEqual({ ok: false, error: "released" });
    expect((await refusals(database)).map((row) => row.reason_code)).toEqual(["released"]);
  });

  it("refuses a request or a sample of another lab", async () => {
    const { database, w } = await open();
    await afinionCrp(database, w);
    expect(await seam(database, w, { labId: w.otherLabId })).toEqual({
      ok: false,
      error: "request_not_found",
    });
    expect(await seam(database, w, { sampleId: "01960000-0000-7000-8000-00000000beef" })).toEqual({
      ok: false,
      error: "sample_not_found",
    });
  });
});

describe("who records a measurement (S10, E1)", () => {
  it("answers a student of another lab not_found, logged, and stores nothing", async () => {
    const { database, w } = await open();
    const lines = await securityLines(async () => {
      expect(await recordManualMeasurement(database, w.otherLabStudent, input(w))).toEqual({
        ok: false,
        error: "not_found",
      });
    });
    expect(lines).toContainEqual(notFoundLine(w.otherLabStudent.id, "lab", w.labId));
    expect(await stored(database, w.requestId)).toEqual([]);
  });

  it("answers a student of another lab who names their own lab and this request request_not_found", async () => {
    const { database, w } = await open();
    expect(
      await recordManualMeasurement(database, w.otherLabStudent, {
        ...input(w),
        labId: w.otherLabId,
      }),
    ).toEqual({ ok: false, error: "request_not_found" });
  });

  it("answers a student outside the simulation and a student in no lab not_found", async () => {
    const { database, w } = await open();
    for (const actor of [w.outsideStudent, w.stranger]) {
      expect(await recordManualMeasurement(database, actor, input(w))).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("answers a malformed lab id not_found", async () => {
    const { database, w } = await open();
    expect(
      await recordManualMeasurement(database, w.student, { ...input(w), labId: "nope" }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a teacher, a co-teacher and an administrator with a 403", async () => {
    const { database, w } = await open();
    for (const actor of [w.teacher, w.coTeacher, w.admin]) {
      await expect(recordManualMeasurement(database, actor, input(w))).rejects.toThrow(AuthError);
    }
    expect(await stored(database, w.requestId)).toEqual([]);
  });
});

describe("more refusals of entry by hand (security review of #370)", () => {
  it("logs each refusal of entry by hand with its reason (N1)", async () => {
    const { database, w } = await open();
    await afinionCrp(database, w);
    await recordManualMeasurement(database, w.student, { ...input(w), testId: w.crp });
    await recordManualMeasurement(database, w.student, { ...input(w), value: "1e5" });
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    await recordManualMeasurement(database, w.student, input(w));
    expect(await refusals(database)).toEqual([
      { actor_type: "user", reason_code: "not_manual_test" },
      { actor_type: "user", reason_code: "value_invalid" },
      { actor_type: "user", reason_code: "not_running" },
    ]);
  });

  it("refuses a sample of another lab on the student's own request, logged", async () => {
    const { database, w } = await open();
    const patientId = await patientIn(database, w.otherLabStudent, w.otherLabId);
    const theirs = await requestFor(database, w.otherLabStudent, w.otherLabId, patientId, [
      w.hba1c,
    ]);
    const sampleId = theirs.samples[0]?.id ?? "";
    expect(await recordManualMeasurement(database, w.student, { ...input(w), sampleId })).toEqual({
      ok: false,
      error: "sample_not_found",
    });
    expect(await stored(database, theirs.requestId)).toEqual([]);
  });

  it("refuses a student in two simulations who mixes the ids of both", async () => {
    const { database, w } = await open();
    // NOTE: #379, #386; one unfinished simulation per student and one running at a time, so the
    // first one is finished before the second starts.
    await setState(database, w.simulationId, "finished");
    const started = await startSimulation(
      database,
      w.outsiderTeacher,
      { simulationId: w.outsideSimulationId },
      NOW,
    );
    expect(started.ok).toBe(true);
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
    expect(
      await recordManualMeasurement(database, w.student, { ...input(w), labId: w.outsideLabId }),
    ).toEqual({ ok: false, error: "request_not_found" });
    expect(await stored(database, w.requestId)).toEqual([]);
  });

  it("refuses an account with the roles teacher and admin that teaches nothing, with a 403", async () => {
    const { database, w } = await open();
    const both = await person(database, "teacher-admin", ["teacher", "admin"]);
    await expect(recordManualMeasurement(database, both, input(w))).rejects.toThrow(AuthError);
  });
});
