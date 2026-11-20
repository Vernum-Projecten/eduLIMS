// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR step of registerPatientFn after its transaction committed (#147, #364): a FerroEHR
// failure, a call past the 5 s budget and a throw all answer `pending` with the patient still
// registered, so the team never registers a duplicate; a throw is logged once with ids only.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parsePatientId } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { failure, success } from "../openehr/errors.ts";
import { securityLines } from "../simulations/test-helpers.ts";
import {
  ehrAfterRegistration,
  type PatientEhrClient,
  REGISTRATION_EHR_BUDGET_MS,
} from "./patient-ehr.ts";
import { PATIENT, patientIn, recordsWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function registered() {
  db = await createTestDb();
  const w = await recordsWorld(db);
  const id = parsePatientId(await patientIn(db, w.student, w.labId));
  if (id === null) throw new Error("malformed patient id");
  return { database: db, w, patientId: id };
}

const EHR_ID = "01a1f79f-0000-7000-8000-000000000001";

const answering: PatientEhrClient = {
  getEhrBySubject: async () => success(null),
  createEhr: async () => success({ outcome: "created", ehr: { ehr_id: { value: EHR_ID } } }),
};

const unreachable: PatientEhrClient = {
  getEhrBySubject: async () =>
    failure({ kind: "unreachable", target: "ferroehr", cause: new TypeError("fetch failed") }),
  createEhr: async () => success({ outcome: "conflict" }),
};

/** A FerroEHR that never answers: only the budget ends the call. */
const hanging: PatientEhrClient = {
  getEhrBySubject: () => new Promise(() => {}),
  createEhr: () => new Promise(() => {}),
};

describe("the EHR step of a registration (#147, #364)", () => {
  it("reports ready when FerroEHR answers", async () => {
    const { database, patientId } = await registered();
    expect(await ehrAfterRegistration(database, answering, patientId)).toBe("ready");
  });

  it("reports pending when FerroEHR is unreachable, the patient still registered", async () => {
    const { database, patientId } = await registered();
    const lines = await securityLines(async () => {
      expect(await ehrAfterRegistration(database, unreachable, patientId)).toBe("pending");
    });
    expect(lines.map((line) => line["event"])).toEqual(["ferroehr_ehr_pending"]);
    const row = await database
      .selectFrom("patients")
      .select(["id", "ehr_id"])
      .where("id", "=", patientId)
      .executeTakeFirst();
    expect(row).toEqual({ id: patientId, ehr_id: null });
  });

  it("reports pending once the budget runs out, as a timeout", async () => {
    const { database, patientId } = await registered();
    const lines = await securityLines(async () => {
      const state = await ehrAfterRegistration(database, hanging, patientId, { budgetMs: 20 });
      expect(state).toBe("pending");
    });
    expect(lines).toEqual([
      expect.objectContaining({ event: "ferroehr_ehr_pending", kind: "timeout" }),
    ]);
  });

  it("gives the registration 5 s with FerroEHR in all", () => {
    expect(REGISTRATION_EHR_BUDGET_MS).toBe(5_000);
  });

  it("reports pending when the EHR step throws, and logs ferroehr_ehr_failed once with ids", async () => {
    const { database, w } = await registered();
    // A patient id with no row: ensurePatientEhr throws before it asks FerroEHR.
    const gone = parsePatientId("0190f1c2-0000-7000-8000-00000000dead");
    if (gone === null) throw new Error("malformed patient id");
    let state: string | undefined;
    const lines = await securityLines(async () => {
      state = await ehrAfterRegistration(database, answering, gone);
    });
    expect(state).toBe("pending");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        event: "ferroehr_ehr_failed",
        target_type: "patient",
        target_id: gone,
        cause: ["Error"],
      }),
    ]);
    const text = JSON.stringify(lines);
    for (const absent of [PATIENT.name, w.student.email, w.student.id]) {
      expect(text).not.toContain(absent);
    }
  });
});
