// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The refusals around the tests not offered of a request (#398, security review of #405): a lone
// UTF-16 surrogate is refused by the shared schemas, a refused correction leaves an audit row,
// the correction log that holds them is the simulation's teachers' only, the list message names
// its bound, and the rows go with their simulation. Every name here is invented (Q-PRIV-4).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "@/i18n/messages";
import { NOT_OFFERED_MAX } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { deleteSimulation } from "../simulations/simulations.ts";
import { auditRows, NOW, setState } from "../simulations/test-helpers.ts";
import { readCorrectionLog } from "./correction-log.ts";
import { correctRequest } from "./requests.ts";
import { correctRequestInput, recordRequestInput, requestFormSchema } from "./schemas.ts";
import { patientIn, recordsWorld, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const LONE = "Invented\uD800Q";
const ID = "0195f0c0-0000-7000-8000-000000000001";

const CONTROL = {
  kind: "control",
  labId: ID,
  requester: "",
  phoneThrough: false,
  remarks: "",
  testIds: [ID],
  samples: [{ sampleNumber: "QC-1", material: "control material" }],
} as const;

async function open() {
  const database = await createTestDb();
  db = database;
  const w = await recordsWorld(database);
  const patientId = await patientIn(database, w.student, w.labId);
  const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c], {
    notOffered: [{ name: "Invented test Q", remark: null }],
  });
  const [sample] = recorded.samples;
  if (!sample) throw new Error("no sample");
  const correction = {
    labId: w.labId,
    requestId: recorded.requestId,
    requester: "Dr. Invented",
    phoneThrough: false,
    remarks: null,
    testIds: [w.hba1c],
    samples: [{ sampleId: sample.id, sampleNumber: "S-001", material: "whole blood" }],
  };
  return { database, w, recorded, correction };
}

describe("a lone surrogate (security review of #405, S1)", () => {
  it("is refused in the name and the remark of a test not offered", () => {
    for (const entry of [
      { name: LONE, remark: "" },
      { name: "Invented test Q", remark: LONE },
    ]) {
      expect(recordRequestInput.safeParse({ ...CONTROL, notOffered: [entry] }).success).toBe(false);
    }
  });

  it("is refused in a correction by its validator, at the field, so the service never sees it", () => {
    const parsed = correctRequestInput.safeParse({
      labId: ID,
      requestId: ID,
      requester: "",
      phoneThrough: false,
      remarks: `two lines\n${LONE}`,
      testIds: [ID],
      notOffered: [{ name: LONE, remark: "" }],
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([
      ["remarks"],
      ["notOffered", 0, "name"],
    ]);
  });

  it("is refused in a sample number, the remarks and a requester alike", () => {
    expect(recordRequestInput.safeParse({ ...CONTROL, requester: LONE }).success).toBe(false);
    expect(recordRequestInput.safeParse({ ...CONTROL, remarks: LONE }).success).toBe(false);
    expect(
      recordRequestInput.safeParse({
        ...CONTROL,
        samples: [{ sampleNumber: LONE, material: "control material" }],
      }).success,
    ).toBe(false);
    // A whole character outside the BMP stays allowed.
    expect(recordRequestInput.safeParse({ ...CONTROL, remarks: "ok \u{1F600}" }).success).toBe(
      true,
    );
  });
});

describe("the list's bound (#398)", () => {
  it("says the bound for a 21st entry, at the list", () => {
    const entry = { key: "k", name: "Invented test Q", remark: "" };
    const form = requestFormSchema.safeParse({
      ...CONTROL,
      patientId: "",
      notOffered: Array.from({ length: NOT_OFFERED_MAX + 1 }, (_, index) => ({
        ...entry,
        key: String(index),
      })),
      samples: [{ key: "a", sampleNumber: "QC-1", material: "control material" }],
    });
    expect(form.error?.issues).toEqual([
      expect.objectContaining({
        path: ["notOffered"],
        message: m.records_not_offered_too_many({ max: String(NOT_OFFERED_MAX) }),
      }),
    ]);
  });
});

describe("refused corrections leave an audit row (security review of #405)", () => {
  it("logs requester_required with the request's id", async () => {
    const { database, w, recorded, correction } = await open();
    const result = await correctRequest(database, w.student, { ...correction, requester: null });
    expect(result).toEqual({ ok: false, error: "requester_required" });
    expect(await auditRows(database, "lab_request_corrected")).toEqual([
      expect.objectContaining({
        actor_id: w.student.id,
        outcome: "refused",
        reason_code: "requester_required",
        target_id: w.labId,
        metadata: { lab_request_id: recorded.requestId },
      }),
    ]);
  });

  it("logs test_not_found and test_retired", async () => {
    const { database, w, correction } = await open();
    const unknown = "01960000-0000-7000-8000-00000000dead";
    expect(
      await correctRequest(database, w.student, {
        ...correction,
        testIds: [w.hba1c, unknown],
      }),
    ).toEqual({ ok: false, error: "test_not_found" });
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: NOW })
      .where("id", "=", w.crp)
      .execute();
    expect(
      await correctRequest(database, w.student, { ...correction, testIds: [w.hba1c, w.crp] }),
    ).toEqual({ ok: false, error: "test_retired" });
    const rows = await auditRows(database, "lab_request_corrected");
    expect(rows.map((row) => [row.outcome, row.reason_code])).toEqual([
      ["refused", "test_not_found"],
      ["refused", "test_retired"],
    ]);
  });
});

describe("the correction log with tests not offered (D10, D11; security review of #405, N4)", () => {
  it("is read by the simulation's teachers only", async () => {
    const { database, w, correction } = await open();
    const changed = await correctRequest(database, w.student, { ...correction, notOffered: [] });
    expect(changed).toEqual({ ok: true, value: { changed: 1 } });
    const own = await readCorrectionLog(database, w.teacher, w.simulationId);
    expect(own?.entries[0]?.changes[0]?.field).toBe("not_offered");
    expect(await readCorrectionLog(database, w.outsiderTeacher, w.simulationId)).toBeNull();
    for (const actor of [w.admin, w.student, w.otherLabStudent]) {
      await expect(readCorrectionLog(database, actor, w.simulationId)).rejects.toThrow(AuthError);
    }
  });
});

describe("deleting a simulation with tests not offered (security review of #405, N1)", () => {
  it("keeps them while the service refuses the delete, and the database cascade takes them", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    // Test set-up: every student leaves, so only the records stand in the way.
    await database.deleteFrom("lab_members").where("simulation_id", "=", w.simulationId).execute();
    expect(await deleteSimulation(database, w.teacher, { simulationId: w.simulationId })).toEqual({
      ok: false,
      error: "has_records",
    });
    const rows = () =>
      database
        .selectFrom("request_tests_not_offered")
        .select("id")
        .where("lab_id", "=", w.labId)
        .execute();
    expect(await rows()).toHaveLength(1);
    await database.deleteFrom("simulations").where("id", "=", w.simulationId).execute();
    expect(await rows()).toEqual([]);
  });
});
