// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Releasing a result (S15, #270) on a real database: one measurement of a requested test becomes
// the result, with the time of release from the database clock and the tolerance in force kept;
// a release needs a tolerance (S13); a released result is final; and only the lab whose sample it
// is releases it (maintainer on #270).
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { correctRequest, recordRequest } from "../lab-records/requests.ts";
import { AuthError } from "../middleware.ts";
import { deleteSimulation } from "../simulations/simulations.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import {
  auditRows,
  NOW,
  person,
  place,
  securityLines,
  setState,
} from "../simulations/test-helpers.ts";
import { insertMeasurement } from "./measurements.ts";
import { type ReleaseInput, releaseResult } from "./release.ts";
import { measure, type ResultsWorld, resultsWorld, toleranceFor } from "./test-helpers.ts";

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

function input(w: ResultsWorld, measurementId: string, toleranceId = w.toleranceId): ReleaseInput {
  return { labId: w.labId, requestId: w.requestId, testId: w.hba1c, measurementId, toleranceId };
}

function releaseRow(database: Kysely<DB>, w: ResultsWorld, testId = w.hba1c) {
  return database
    .selectFrom("request_tests")
    .select(["released_at", "released_measurement_id", "released_tolerance_id", "released_by"])
    .where("request_id", "=", w.requestId)
    .where("test_id", "=", testId)
    .executeTakeFirstOrThrow();
}

describe("releasing a result (S15)", () => {
  it("releases the chosen measurement with the tolerance in force and who released it", async () => {
    const { database, w } = await open();
    await measure(database, w, "5.1");
    const chosen = await measure(database, w, "5.3");
    const result = await releaseResult(database, w.student, input(w, chosen));
    if (!result.ok) throw new Error(result.error);
    expect(result.value.check).toBe("inside");
    expect(await releaseRow(database, w)).toMatchObject({
      released_measurement_id: chosen,
      released_tolerance_id: w.toleranceId,
      released_by: w.student.id,
    });
  });

  it("takes the time of release from the database clock of the storing transaction (Q-SIM-2)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.3");
    const before = await sql<{ now: Date }>`select now() as now`.execute(database);
    const crafted = { ...input(w, chosen), releasedAt: "2000-01-01T00:00:00Z" };
    const result = await releaseResult(database, w.student, crafted);
    if (!result.ok) throw new Error(result.error);
    const row = await releaseRow(database, w);
    expect(row.released_at?.toISOString()).toBe(result.value.releasedAt);
    expect(row.released_at?.getTime()).toBeGreaterThanOrEqual(
      (before.rows[0]?.now ?? new Date()).getTime(),
    );
  });

  it("reports a value below and above the tolerance, and releases it once confirmed (S15)", async () => {
    const { database, w } = await open();
    const low = await measure(database, w, "3.999");
    const result = await releaseResult(database, w.student, input(w, low));
    expect(result).toMatchObject({ ok: true, value: { check: "below" } });
    const high = await measure(database, w, "6.001", { testId: w.crp });
    const crpTolerance = await toleranceFor(database, w.student, w.labId, w.crp, "1", "6");
    const above = await releaseResult(database, w.student, {
      ...input(w, high, crpTolerance),
      testId: w.crp,
    });
    expect(above).toMatchObject({ ok: true, value: { check: "above" } });
  });

  it("counts a value exactly on a limit as inside (S13)", async () => {
    const { database, w } = await open();
    const onLimit = await measure(database, w, "6.000");
    expect(await releaseResult(database, w.student, input(w, onLimit))).toMatchObject({
      ok: true,
      value: { check: "inside" },
    });
  });

  it("keeps the tolerance in force at the release when the team changes it later (S15)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.3");
    await releaseResult(database, w.student, input(w, chosen));
    await toleranceFor(database, w.student, w.labId, w.hba1c, "1", "2");
    expect((await releaseRow(database, w)).released_tolerance_id).toBe(w.toleranceId);
  });

  it("returns the record for the patient's record, with no tolerance and no student (Q-PRIV-1)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.3");
    const result = await releaseResult(database, w.student, input(w, chosen));
    if (!result.ok) throw new Error(result.error);
    expect(result.value.record).toEqual({
      patientId: w.patientId,
      requestId: w.requestId,
      testId: w.hba1c,
      measurementId: chosen,
      sampleNumber: "S-001",
      testName: "HbA1c (invented)",
      unit: "mmol/L",
      value: "5.3",
      releasedAt: result.value.releasedAt,
    });
    const text = JSON.stringify(result.value.record);
    expect(text).not.toContain(w.toleranceId);
    expect(text).not.toContain(w.student.id);
    expect(text).not.toContain(w.student.email);
  });

  it("gives a control request no record for a patient's record (S16)", async () => {
    const { database, w } = await open();
    const control = await recordRequest(database, w.student, {
      kind: "control",
      labId: w.labId,
      requester: null,
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c],
      samples: [{ sampleNumber: "QC-1", material: "control" }],
    });
    if (!control.ok) throw new Error(control.error);
    const sampleId = control.value.samples[0]?.id ?? "";
    const measured = await measure(database, { ...w, requestId: control.value.requestId }, "5.0", {
      sampleId,
    });
    const result = await releaseResult(database, w.student, {
      ...input(w, measured),
      requestId: control.value.requestId,
    });
    expect(result).toMatchObject({ ok: true, value: { record: null } });
  });

  it("logs the ids of the release, never the value or the limits (E4)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.3");
    await releaseResult(database, w.student, input(w, chosen));
    const rows = await auditRows(database, "lab_result_released");
    expect(rows).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: {
          lab_request_id: w.requestId,
          test_id: w.hba1c,
          measurement_id: chosen,
          tolerance_id: w.toleranceId,
        },
      },
    ]);
  });
});

describe("a released result is final (S15)", () => {
  it("refuses a second release of the same measurement or of another one", async () => {
    const { database, w } = await open();
    const first = await measure(database, w, "5.1");
    const second = await measure(database, w, "5.2");
    expect((await releaseResult(database, w.student, input(w, first))).ok).toBe(true);
    for (const id of [first, second]) {
      expect(await releaseResult(database, w.student, input(w, id))).toEqual({
        ok: false,
        error: "released",
      });
    }
    expect((await releaseRow(database, w)).released_measurement_id).toBe(first);
    const refusals = await auditRows(database, "lab_result_released");
    expect(refusals.filter((row) => row.outcome === "refused")).toHaveLength(2);
  });

  it("locks the request against a correction (S12)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    await releaseResult(database, w.student, input(w, chosen));
    const corrected = await correctRequest(database, w.student, {
      labId: w.labId,
      requestId: w.requestId,
      requester: "Dr. Later",
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c, w.crp],
      samples: [],
    });
    expect(corrected).toEqual({ ok: false, error: "released" });
  });

  it("keeps a requested test with a measurement on the request in a correction (S14)", async () => {
    const { database, w } = await open();
    await measure(database, w, "5.1", { testId: w.crp });
    const corrected = await correctRequest(database, w.student, {
      labId: w.labId,
      requestId: w.requestId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c],
      samples: [],
    });
    expect(corrected).toEqual({ ok: false, error: "test_removed" });
  });
});

describe("what a release needs (S13, S15)", () => {
  it("refuses a test without a tolerance (maintainer, 2026-11-19)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1", { testId: w.crp });
    expect(
      await releaseResult(database, w.student, { ...input(w, chosen), testId: w.crp }),
    ).toEqual({ ok: false, error: "no_tolerance" });
    expect((await releaseRow(database, w, w.crp)).released_at).toBeNull();
  });

  it("refuses when the tolerance in force is not the one the team confirmed", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    await toleranceFor(database, w.labStudents[1] ?? w.student, w.labId, w.hba1c, "5.0", "5.05");
    expect(await releaseResult(database, w.student, input(w, chosen))).toEqual({
      ok: false,
      error: "tolerance_changed",
    });
  });

  it("refuses a measurement of another test of the request, logged", async () => {
    const { database, w } = await open();
    const crp = await measure(database, w, "5.1", { testId: w.crp });
    const lines = await securityLines(async () => {
      expect(await releaseResult(database, w.student, input(w, crp))).toEqual({
        ok: false,
        error: "measurement_not_found",
      });
    });
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "authz_fail", target_type: "measurement", target_id: crp }),
    );
  });

  it("refuses a malformed measurement id", async () => {
    const { database, w } = await open();
    expect(await releaseResult(database, w.student, input(w, "not-an-id"))).toEqual({
      ok: false,
      error: "measurement_not_found",
    });
  });

  it("refuses a test the request does not name", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    expect(
      await releaseResult(database, w.student, {
        ...input(w, chosen),
        testId: "01960000-0000-7000-8000-00000000beef",
      }),
    ).toEqual({ ok: false, error: "test_not_found" });
  });

  it("refuses a release in a simulation that does not run", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await releaseResult(database, w.student, input(w, chosen))).toEqual({
      ok: false,
      error: "not_running",
    });
  });
});

describe("who releases (S10, R-11; maintainer on #270)", () => {
  it("lets only the lab whose sample it is release a result another team's analyser sent", async () => {
    const { database, w } = await open();
    await database
      .updateTable("catalogue_tests")
      .set({ source: "afinion", afinion_analyte: "HbA1c" })
      .where("id", "=", w.hba1c)
      .execute();
    const landed = await database.transaction().execute((trx) =>
      insertMeasurement(trx, {
        labId: w.labId,
        requestId: w.requestId,
        testId: w.hba1c,
        sampleId: w.first.id,
        value: "5.5",
        source: "afinion",
        recordedBy: null,
        auditActor: { type: "system" },
      }),
    );
    if (!landed.ok) throw new Error(landed.error);
    const id = landed.value.measurementId;
    expect(await releaseResult(database, w.otherLabStudent, input(w, id))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await releaseResult(database, w.otherLabStudent, { ...input(w, id), labId: w.otherLabId }),
    ).toEqual({ ok: false, error: "request_not_found" });
    expect((await releaseResult(database, w.student, input(w, id))).ok).toBe(true);
  });

  it("answers a student outside the simulation and a student in no lab not_found", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    for (const actor of [w.outsideStudent, w.stranger]) {
      expect(await releaseResult(database, actor, input(w, chosen))).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("refuses a teacher, a co-teacher and an administrator with a 403", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    for (const actor of [w.teacher, w.coTeacher, w.outsiderTeacher, w.admin]) {
      await expect(releaseResult(database, actor, input(w, chosen))).rejects.toThrow(AuthError);
    }
    expect((await releaseRow(database, w)).released_at).toBeNull();
  });
});

describe("more cases of the release (security review of #370)", () => {
  it("counts a value exactly on the lower limit as inside, and 4.000000 as 4 (N5)", async () => {
    const { database, w } = await open();
    const exact = await toleranceFor(database, w.student, w.labId, w.crp, "4", "6");
    const onLower = await measure(database, w, "4.000000", { testId: w.crp });
    expect(
      await releaseResult(database, w.student, {
        ...input(w, onLower, exact),
        testId: w.crp,
      }),
    ).toMatchObject({ ok: true, value: { check: "inside" } });
    const lowest = await measure(database, w, "4.0");
    expect(await releaseResult(database, w.student, input(w, lowest))).toMatchObject({
      ok: true,
      value: { check: "inside" },
    });
  });

  it("refuses a student in two simulations who mixes the ids of both", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
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
      await releaseResult(database, w.student, { ...input(w, chosen), labId: w.outsideLabId }),
    ).toEqual({ ok: false, error: "request_not_found" });
    expect((await releaseRow(database, w)).released_at).toBeNull();
  });

  it("refuses an account with the roles teacher and admin that teaches nothing, with a 403", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    const both = await person(database, "teacher-admin", ["teacher", "admin"]);
    await expect(releaseResult(database, both, input(w, chosen))).rejects.toThrow(AuthError);
  });

  it("logs a release refused because the simulation does not run (N1)", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    await releaseResult(database, w.student, input(w, chosen));
    const rows = await auditRows(database, "lab_result_released");
    expect(rows.map((row) => [row.outcome, row.reason_code])).toEqual([["refused", "not_running"]]);
  });
});

describe("deleting a simulation with records (maintainer on #370, Q2)", () => {
  it("refuses a finished simulation with a released result, logged, and keeps its rows", async () => {
    const { database, w } = await open();
    const chosen = await measure(database, w, "5.1");
    await releaseResult(database, w.student, input(w, chosen));
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    // Test set-up: every student leaves, so only the records stand in the way.
    await database.deleteFrom("lab_members").where("simulation_id", "=", w.simulationId).execute();
    expect(await deleteSimulation(database, w.teacher, { simulationId: w.simulationId })).toEqual({
      ok: false,
      error: "has_records",
    });
    const rows = await auditRows(database, "simulation_deleted");
    expect(rows.map((row) => [row.outcome, row.reason_code])).toEqual([["refused", "has_records"]]);
    expect((await releaseRow(database, w)).released_measurement_id).toBe(chosen);
  });
});
