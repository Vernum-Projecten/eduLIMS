// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The tests a request form asks for that the lab does not offer (S12, D11, Q-SIM-1, #398): stored
// per request as the team typed them, editable until the first release with every change in the
// correction log, read by the team and the simulation's teachers, never by another team. Nothing
// compares an entry with the catalogue. Every name here is invented (Q-PRIV-4).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { NOT_OFFERED_MAX, NOT_OFFERED_NAME_MAX } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { readStudentResults, readTeacherResults } from "../results/queries.ts";
import { readCorrectionLog } from "./correction-log.ts";
import { readLabRecords } from "./queries.ts";
import { correctRequest } from "./requests.ts";
import { correctRequestInput, recordRequestInput, requestFormSchema } from "./schemas.ts";
import { patientIn, recordsWorld, release, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const ENTRIES = [
  { name: "Invented test Q", remark: null },
  { name: "Invented panel Z", remark: "second page of the form" },
];

async function open(notOffered = ENTRIES) {
  const database = await createTestDb();
  db = database;
  const w = await recordsWorld(database);
  const patientId = await patientIn(database, w.student, w.labId);
  const recorded = await requestFor(database, w.student, w.labId, patientId, [w.hba1c], {
    notOffered,
  });
  const [sample] = recorded.samples;
  if (!sample) throw new Error("no sample");
  return { database, w, recorded, sample };
}

describe("recording tests not offered (S12, #398)", () => {
  it("stores them with the request in the order typed, and the team reads them", async () => {
    const { database, w } = await open();
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual(ENTRIES);
  });

  it("stores none when the request lists none", async () => {
    const { database, w } = await open([]);
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual([]);
  });

  it("stores a name that is also a catalogue test as typed, compared with nothing (Q-SIM-1)", async () => {
    const { database, w } = await open([{ name: "HbA1c (invented)", remark: null }]);
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual([{ name: "HbA1c (invented)", remark: null }]);
    expect(records?.requests[0]?.tests.map((test) => test.id)).toEqual([w.hba1c]);
  });
});

describe("who reads tests not offered (S10, D11, Q-SIM-1)", () => {
  it("shows them to the simulation's teachers on the lab's work and to the team's results", async () => {
    const { database, w } = await open();
    for (const actor of [w.teacher, w.coTeacher]) {
      const page = await readTeacherResults(database, actor, w.labId);
      expect(page?.requests[0]?.notOffered).toEqual(ENTRIES);
    }
    const own = await readStudentResults(database, w.student, w.labId);
    expect(own?.requests[0]?.notOffered).toEqual(ENTRIES);
  });

  it("gives a student of another lab and a teacher of another simulation nothing", async () => {
    const { database, w } = await open();
    expect(await readLabRecords(database, w.otherLabStudent, w.labId)).toBeNull();
    expect(await readStudentResults(database, w.otherLabStudent, w.labId)).toBeNull();
    expect(await readTeacherResults(database, w.outsiderTeacher, w.labId)).toBeNull();
    const theirs = await readLabRecords(database, w.otherLabStudent, w.otherLabId);
    expect(theirs?.requests).toEqual([]);
  });
});

describe("correcting tests not offered (S12, #398)", () => {
  const base = (w: Awaited<ReturnType<typeof open>>["w"], requestId: string, sampleId: string) => ({
    labId: w.labId,
    requestId,
    requester: "Dr. Invented",
    phoneThrough: false,
    remarks: null,
    testIds: [w.hba1c],
    samples: [{ sampleId, sampleNumber: "S-001", material: "whole blood" }],
  });

  it("replaces the list and logs it before and after for the teacher", async () => {
    const { database, w, recorded, sample } = await open();
    const after = [{ name: "Invented panel Z", remark: null }];
    const result = await correctRequest(database, w.student, {
      ...base(w, recorded.requestId, sample.id),
      notOffered: after,
    });
    expect(result).toEqual({ ok: true, value: { changed: 1 } });
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual(after);
    const log = await readCorrectionLog(database, w.teacher, w.simulationId);
    expect(log?.entries[0]?.changes).toEqual([{ field: "not_offered", before: ENTRIES, after }]);
  });

  it("changes nothing when the list is left out or the same", async () => {
    const { database, w, recorded, sample } = await open();
    for (const notOffered of [undefined, ENTRIES]) {
      const result = await correctRequest(database, w.student, {
        ...base(w, recorded.requestId, sample.id),
        notOffered,
      });
      expect(result).toEqual({ ok: true, value: { changed: 0 } });
    }
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual(ENTRIES);
  });

  it("refuses a correction once a result of the request is released", async () => {
    const { database, w, recorded, sample } = await open();
    await release(database, recorded.requestId);
    const result = await correctRequest(database, w.student, {
      ...base(w, recorded.requestId, sample.id),
      notOffered: [],
    });
    expect(result).toEqual({ ok: false, error: "released" });
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual(ENTRIES);
  });

  it("refuses another lab's request as not found and leaves its list alone", async () => {
    const { database, w, recorded, sample } = await open();
    const result = await correctRequest(database, w.otherLabStudent, {
      ...base(w, recorded.requestId, sample.id),
      labId: w.otherLabId,
      notOffered: [],
    });
    expect(result).toEqual({ ok: false, error: "request_not_found" });
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual(ENTRIES);
  });
});

describe("the bounds of tests not offered (#398)", () => {
  const request = {
    kind: "control",
    labId: "0195f0c0-0000-7000-8000-000000000001",
    requester: "",
    phoneThrough: false,
    remarks: "",
    testIds: ["0195f0c0-0000-7000-8000-000000000002"],
    samples: [{ sampleNumber: "QC-1", material: "control material" }],
  } as const;

  it("defaults to none and trims each entry, an empty remark becoming null", () => {
    expect(recordRequestInput.parse(request).notOffered).toEqual([]);
    const parsed = recordRequestInput.parse({
      ...request,
      notOffered: [{ name: "  Invented test Q ", remark: " " }],
    });
    expect(parsed.notOffered).toEqual([{ name: "Invented test Q", remark: null }]);
  });

  it("refuses an empty name, a name past its bound and a control character", () => {
    for (const name of ["", " ", "x".repeat(NOT_OFFERED_NAME_MAX + 1), "Invented\u0000Q"]) {
      expect(
        recordRequestInput.safeParse({ ...request, notOffered: [{ name, remark: "" }] }).success,
      ).toBe(false);
    }
    const atBound = "x".repeat(NOT_OFFERED_NAME_MAX);
    expect(
      recordRequestInput.safeParse({ ...request, notOffered: [{ name: atBound, remark: "" }] })
        .success,
    ).toBe(true);
  });

  it("refuses more entries than the bound, at the list", () => {
    const entry = { name: "Invented test Q", remark: "" };
    const full = Array.from({ length: NOT_OFFERED_MAX }, () => entry);
    expect(recordRequestInput.safeParse({ ...request, notOffered: full }).success).toBe(true);
    expect(recordRequestInput.safeParse({ ...request, notOffered: [...full, entry] }).success).toBe(
      false,
    );
    const form = requestFormSchema.safeParse({
      ...request,
      patientId: "",
      notOffered: [...full, entry].map((row, index) => ({ ...row, key: String(index) })),
      samples: [{ key: "a", sampleNumber: "QC-1", material: "control material" }],
    });
    expect(form.error?.issues[0]?.path).toEqual(["notOffered"]);
  });

  it("leaves a correction without the list unchanged, so an older client clears nothing", () => {
    const parsed = correctRequestInput.parse({
      labId: request.labId,
      requestId: request.labId,
      requester: "",
      phoneThrough: false,
      remarks: "",
      testIds: request.testIds,
      samples: [{ sampleNumber: "QC-1", material: "control material" }],
    });
    expect(parsed.notOffered).toBeUndefined();
  });
});

describe("the not-offered table (#398)", () => {
  /** Inserts one row in its own transaction, so a refusal leaves the test's open. */
  function insert(
    database: Kysely<DB>,
    labId: string,
    requestId: string,
    position: number,
    name: string,
  ) {
    return database
      .transaction()
      .execute((trx) =>
        trx
          .insertInto("request_tests_not_offered")
          .values({ lab_id: labId, request_id: requestId, position, name })
          .execute(),
      );
  }

  it("refuses a row whose lab is not its request's lab", async () => {
    const { database, w, recorded } = await open();
    await expect(
      insert(database, w.otherLabId, recorded.requestId, 5, "Invented test Q"),
    ).rejects.toThrow(/request_tests_not_offered_request_fkey/);
  });

  it("refuses an untrimmed or empty name and a repeated position", async () => {
    const { database, w, recorded } = await open();
    for (const name of [" padded", ""]) {
      await expect(insert(database, w.labId, recorded.requestId, 7, name)).rejects.toThrow(
        /request_tests_not_offered_name/,
      );
    }
    await expect(
      insert(database, w.labId, recorded.requestId, 0, "Invented test Q"),
    ).rejects.toThrow(/request_tests_not_offered_position_key/);
  });
});
