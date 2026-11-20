// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements of a requested test (S14, #270) on a real database: a second measurement is kept
// beside the first, the server takes the time, a value is parsed and bounded before it is stored,
// and only a member of the lab enters one by hand, only for a hand-entered test, before the release.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { requestFor } from "../lab-records/test-helpers.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW, notFoundLine, securityLines } from "../simulations/test-helpers.ts";
import { insertMeasurement, recordManualMeasurement } from "./measurements.ts";
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
    it(`refuses ${JSON.stringify(value)} with value_invalid and stores nothing`, async () => {
      const { database, w } = await open();
      const result = await database.transaction().execute((trx) =>
        insertMeasurement(trx, {
          simulationId: w.simulationId,
          labId: w.labId,
          requestId: w.requestId,
          testId: w.hba1c,
          sampleId: w.first.id,
          value,
          source: "epoch_upload",
          recordedBy: null,
        }),
      );
      expect(result).toEqual({ ok: false, error: "value_invalid" });
      expect(await stored(database, w.requestId)).toEqual([]);
    });
  }

  it("stores an analyser's measurement with no student and a system actor", async () => {
    const { database, w } = await open();
    const result = await database.transaction().execute((trx) =>
      insertMeasurement(trx, {
        simulationId: w.simulationId,
        labId: w.labId,
        requestId: w.requestId,
        testId: w.hba1c,
        sampleId: w.second.id,
        value: "123456789.123456",
        source: "afinion",
        recordedBy: null,
      }),
    );
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
