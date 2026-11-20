// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Correcting a request (S12; maintainer, 2026-11-19 on #268): allowed until the first result of
// the request is released, logged for the teacher with the fields before and after, never a
// change of the time of entry, a second tube with a fresh lab number, no sample removed.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { isLabNumber } from "../../lib/lab-number.ts";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { auditRows, securityLines } from "../simulations/test-helpers.ts";
import { correctRequest, type RequestCorrection, recordRequest } from "./requests.ts";
import { patientIn, type RecordsWorld, recordsWorld, release, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await recordsWorld(db);
  const patientId = await patientIn(db, w.student, w.labId);
  const recorded = await requestFor(db, w.student, w.labId, patientId, [w.hba1c]);
  const [sample] = recorded.samples;
  if (!sample) throw new Error("no sample");
  return { db, w, patientId, recorded, sample };
}

/** The correction that changes nothing of the request {@link open} recorded. */
function same(w: RecordsWorld, requestId: string, sampleId: string): RequestCorrection {
  return {
    labId: w.labId,
    requestId,
    requester: "Dr. Invented",
    phoneThrough: false,
    remarks: null,
    testIds: [w.hba1c],
    samples: [{ sampleId, sampleNumber: "S-001", material: "whole blood" }],
  };
}

function corrections(database: Kysely<DB>) {
  return database
    .selectFrom("record_corrections")
    .select(["request_id", "patient_id", "corrected_by", "changes"])
    .orderBy("corrected_at")
    .orderBy("id")
    .execute();
}

describe("correcting a request (S12)", () => {
  it("writes the changed fields, its tests and its samples, with one correction row", async () => {
    const { db: database, w, recorded, sample } = await open();
    const result = await correctRequest(database, w.student, {
      ...same(w, recorded.requestId, sample.id),
      requester: "Dr. Other",
      phoneThrough: true,
      testIds: [w.hba1c, w.crp],
      samples: [{ sampleId: sample.id, sampleNumber: "S-010", material: "whole blood" }],
    });
    expect(result).toEqual({ ok: true, value: { changed: 4 } });
    expect(await corrections(database)).toEqual([
      {
        request_id: recorded.requestId,
        patient_id: null,
        corrected_by: w.student.id,
        changes: [
          { field: "requester", before: "Dr. Invented", after: "Dr. Other" },
          { field: "phone_through", before: false, after: true },
          { field: "tests", before: [w.hba1c], after: [w.hba1c, w.crp].sort() },
          { field: "sample_number", sample_id: sample.id, before: "S-001", after: "S-010" },
        ],
      },
    ]);
    const tests = await database
      .selectFrom("request_tests")
      .select("test_id")
      .where("request_id", "=", recorded.requestId)
      .execute();
    expect(tests.map((row) => row.test_id).sort()).toEqual([w.hba1c, w.crp].sort());
    const stored = await database
      .selectFrom("samples")
      .select(["sample_number", "lab_number"])
      .where("id", "=", sample.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ sample_number: "S-010", lab_number: sample.labNumber });
  });

  it("never removes a requested test, measured or not (S12; maintainer on #268)", async () => {
    const { db: database, w, recorded, sample } = await open();
    await correctRequest(database, w.student, {
      ...same(w, recorded.requestId, sample.id),
      testIds: [w.hba1c, w.crp],
    });
    for (const testIds of [[w.crp], [w.hba1c], []]) {
      expect(
        await correctRequest(database, w.student, {
          ...same(w, recorded.requestId, sample.id),
          remarks: "Dropped one.",
          testIds,
        }),
      ).toEqual({ ok: false, error: "test_removed" });
    }
    const tests = await database
      .selectFrom("request_tests")
      .select("test_id")
      .where("request_id", "=", recorded.requestId)
      .execute();
    expect(tests.map((row) => row.test_id).sort()).toEqual([w.hba1c, w.crp].sort());
    expect(await corrections(database)).toHaveLength(1);
  });

  it("never changes the time of entry (S12, Q-SIM-2)", async () => {
    const { db: database, w, recorded, sample } = await open();
    await correctRequest(database, w.student, {
      ...same(w, recorded.requestId, sample.id),
      remarks: "Haemolysed.",
    });
    const row = await database
      .selectFrom("requests")
      .select("entered_at")
      .where("id", "=", recorded.requestId)
      .executeTakeFirstOrThrow();
    expect(row.entered_at.toISOString()).toBe(recorded.enteredAt);
  });

  it("adds a second tube with a fresh lab number and logs it", async () => {
    const { db: database, w, recorded, sample } = await open();
    const correction = same(w, recorded.requestId, sample.id);
    const result = await correctRequest(database, w.student, {
      ...correction,
      samples: [...correction.samples, { sampleNumber: "S-001", material: "whole blood" }],
    });
    expect(result).toEqual({ ok: true, value: { changed: 1 } });
    const samples = await database
      .selectFrom("samples")
      .select(["id", "lab_number"])
      .where("request_id", "=", recorded.requestId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    expect(samples).toHaveLength(2);
    const added = samples.find((row) => row.id !== sample.id);
    expect(isLabNumber(added?.lab_number ?? "")).toBe(true);
    expect((await corrections(database))[0]?.changes).toEqual([
      {
        field: "sample_added",
        sample_id: added?.id,
        sample_number: "S-001",
        material: "whole blood",
        lab_number: added?.lab_number,
      },
    ]);
  });

  it("keeps a sample the correction does not name: a sample is never removed", async () => {
    const { db: database, w, recorded, sample } = await open();
    const result = await correctRequest(database, w.student, {
      ...same(w, recorded.requestId, sample.id),
      samples: [{ sampleNumber: "S-002", material: "plasma" }],
    });
    expect(result.ok).toBe(true);
    const count = await database
      .selectFrom("samples")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("request_id", "=", recorded.requestId)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(2);
  });

  it("writes nothing for a correction that changes nothing", async () => {
    const { db: database, w, recorded, sample } = await open();
    expect(
      await correctRequest(database, w.student, same(w, recorded.requestId, sample.id)),
    ).toEqual({ ok: true, value: { changed: 0 } });
    expect(await corrections(database)).toEqual([]);
    expect(await auditRows(database, "lab_request_corrected")).toEqual([]);
  });

  it("logs lab_request_corrected with the request's id only (E4)", async () => {
    const { db: database, w, recorded, sample } = await open();
    await correctRequest(database, w.student, {
      ...same(w, recorded.requestId, sample.id),
      requester: "Dr. Other",
    });
    const rows = await auditRows(database, "lab_request_corrected");
    expect(rows).toEqual([
      expect.objectContaining({
        outcome: "success",
        metadata: { lab_request_id: recorded.requestId },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("Dr.");
  });

  it("is refused once a result of the request is released, and logged (S12, S15)", async () => {
    const { db: database, w, recorded, sample } = await open();
    await release(database, recorded.requestId);
    expect(
      await correctRequest(database, w.student, {
        ...same(w, recorded.requestId, sample.id),
        requester: "Dr. Other",
      }),
    ).toEqual({ ok: false, error: "released" });
    expect(await auditRows(database, "lab_request_corrected")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "released" }),
    ]);
    expect(await corrections(database)).toEqual([]);
  });

  it("refuses a patient request without a requester", async () => {
    const { db: database, w, recorded, sample } = await open();
    expect(
      await correctRequest(database, w.student, {
        ...same(w, recorded.requestId, sample.id),
        requester: null,
      }),
    ).toEqual({ ok: false, error: "requester_required" });
  });

  it("keeps a test that was retired after the request named it, and refuses adding one (D9)", async () => {
    const { db: database, w, recorded, sample } = await open();
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: new Date() })
      .where("id", "=", w.hba1c)
      .execute();
    const retired = await catalogueTest(database, "Retired (invented)", { retired: true });
    expect(
      await correctRequest(database, w.student, {
        ...same(w, recorded.requestId, sample.id),
        remarks: "Kept.",
      }),
    ).toEqual({ ok: true, value: { changed: 1 } });
    expect(
      await correctRequest(database, w.student, {
        ...same(w, recorded.requestId, sample.id),
        testIds: [w.hba1c, retired],
      }),
    ).toEqual({ ok: false, error: "test_retired" });
  });

  it("refuses a sample of another request as sample_not_found, logged", async () => {
    const { db: database, w, recorded, sample } = await open();
    const control = await recordRequest(database, w.student, {
      kind: "control",
      labId: w.labId,
      requester: null,
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c],
      samples: [{ sampleNumber: "QC-1", material: "control material" }],
    });
    if (!control.ok) throw new Error(control.error);
    const foreign = control.value.samples[0]?.id ?? "";
    const lines = await securityLines(async () => {
      expect(
        await correctRequest(database, w.student, {
          ...same(w, recorded.requestId, sample.id),
          samples: [{ sampleId: foreign, sampleNumber: "S-666", material: "plasma" }],
        }),
      ).toEqual({ ok: false, error: "sample_not_found" });
    });
    expect(lines).toEqual([expect.objectContaining({ target_type: "sample", target_id: foreign })]);
  });

  it("refuses a request of another lab as request_not_found, logged", async () => {
    const { db: database, w, recorded, sample } = await open();
    const lines = await securityLines(async () => {
      expect(
        await correctRequest(database, w.otherLabStudent, {
          ...same(w, recorded.requestId, sample.id),
          labId: w.otherLabId,
          requester: "Hijacked",
        }),
      ).toEqual({ ok: false, error: "request_not_found" });
    });
    expect(lines).toEqual([
      expect.objectContaining({ target_type: "request", target_id: recorded.requestId }),
    ]);
  });

  it("refuses a student of another lab, outside the simulation or in no lab as not_found", async () => {
    const { db: database, w, recorded, sample } = await open();
    for (const actor of [w.otherLabStudent, w.outsideStudent, w.stranger]) {
      expect(
        await correctRequest(database, actor, {
          ...same(w, recorded.requestId, sample.id),
          requester: "Hijacked",
        }),
      ).toEqual({ ok: false, error: "not_found" });
    }
    expect(await corrections(database)).toEqual([]);
  });

  it("refuses a teacher and an administrator with 403", async () => {
    const { db: database, w, recorded, sample } = await open();
    for (const actor of [w.teacher, w.admin]) {
      await expect(
        correctRequest(database, actor, same(w, recorded.requestId, sample.id)),
      ).rejects.toThrow(AuthError);
    }
  });
});
