// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Linking an upload's wells to the lab's samples with the team's results (S4, S10, S14, D9,
// #156): a result for a test the team calculates becomes a measurement of source `epoch_upload`
// with its upload and its wells; anything refused leaves nothing behind but its log row.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { withCheckDigit } from "../../lib/lab-number.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { deviceOfSource } from "../results/ehr-write.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW, notFoundLine, securityLines } from "../simulations/test-helpers.ts";
import { link, linkOf, type UploadWorld, uploaded, uploadWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  const w = await uploadWorld(database);
  const uploadId = await uploaded(database, w.student, w.labId);
  return { database, w, uploadId };
}

function measurements(database: Kysely<DB>) {
  return database
    .selectFrom("measurements")
    .select(["sample_id", "test_id", "source", "upload_id", "recorded_by"])
    .select((eb) => eb.cast<string>("value", "text").as("value"))
    .where("source", "=", "epoch_upload")
    .orderBy("recorded_at")
    .execute();
}

function linkedWells(database: Kysely<DB>) {
  return database
    .selectFrom("upload_wells")
    .select(["well", "sample_id"])
    .where("sample_id", "is not", null)
    .orderBy("well")
    .execute();
}

async function nothingStored(database: Kysely<DB>): Promise<void> {
  expect(await measurements(database)).toEqual([]);
  expect(await linkedWells(database)).toEqual([]);
  const upload = await database.selectFrom("uploads").select("linked_at").executeTakeFirst();
  expect(upload?.linked_at).toBeNull();
}

describe("a linked plate (S4, S14)", () => {
  it("turns the team's result into a measurement of its upload, beside its wells", async () => {
    const { database, w, uploadId } = await open();
    const linked = await link(database, w, linkOf(w, uploadId));
    if (!linked.ok) throw new Error(linked.error);
    expect(await measurements(database)).toEqual([
      {
        sample_id: w.a.id,
        test_id: w.teamTest,
        source: "epoch_upload",
        upload_id: uploadId,
        recorded_by: w.student.id,
        value: "5.25",
      },
    ]);
    expect(await linkedWells(database)).toEqual([
      { well: "A1", sample_id: w.a.id },
      { well: "A2", sample_id: w.a.id },
      { well: "B1", sample_id: w.b.id },
    ]);
    expect(linked.value.linkedAt).not.toBeNull();
    expect(linked.value.measurements).toMatchObject([
      { labNumber: w.a.labNumber, testId: w.teamTest, value: "5.25" },
    ]);
    expect(linked.value.wells.find((well) => well.well === "A2")?.sample).toEqual({
      labNumber: w.a.labNumber,
      sampleNumber: "S-101",
    });
  });

  it("logs the link with ids and a count only (B4, E4)", async () => {
    const { database, w, uploadId } = await open();
    await link(database, w, linkOf(w, uploadId));
    expect(await auditRows(database, "upload_linked")).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "upload",
        target_id: uploadId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, lab_id: w.labId, count: 1 },
      },
    ]);
  });

  it("names the student who entered the result, from the session (maintainer on #400)", async () => {
    const { database, w, uploadId } = await open();
    const classmate = w.labStudents[2] ?? w.student;
    await link(database, w, linkOf(w, uploadId), classmate);
    const [stored] = await measurements(database);
    expect(stored?.recorded_by).toBe(classmate.id);
    const logged = await database
      .selectFrom("audit_event")
      .select(["actor_type", "actor_id"])
      .where("action", "=", "lab_measurement_recorded")
      .execute();
    expect(logged).toEqual([{ actor_type: "user", actor_id: classmate.id }]);
  });

  it("keeps the links without a result, and adds a second file's results beside the first (S14)", async () => {
    const { database, w, uploadId } = await open();
    expect((await link(database, w, { ...linkOf(w, uploadId), results: [] })).ok).toBe(true);
    expect(await measurements(database)).toEqual([]);
    const second = await uploaded(database, w.labStudents[1] ?? w.student, w.labId);
    expect((await link(database, w, linkOf(w, second))).ok).toBe(true);
    expect(
      (await link(database, w, linkOf(w, await uploaded(database, w.student, w.labId)))).ok,
    ).toBe(true);
    expect(await measurements(database)).toHaveLength(2);
  });

  it("names the reader by its serial number for the result write (#148, #152)", async () => {
    const { database, w, uploadId } = await open();
    await link(database, w, linkOf(w, uploadId));
    const row = await database
      .selectFrom("measurements as m")
      .innerJoin("uploads as u", "u.id", "m.upload_id")
      .select(["m.source", "u.reader_serial_number"])
      .executeTakeFirstOrThrow();
    expect(
      deviceOfSource({ source: "epoch_upload", readerSerialNumber: row.reader_serial_number }),
    ).toEqual({ kind: "epoch_2", serialNumber: "2204112B" });
  });

  it("links each upload once", async () => {
    const { database, w, uploadId } = await open();
    await link(database, w, linkOf(w, uploadId));
    expect(await link(database, w, linkOf(w, uploadId))).toEqual({
      ok: false,
      error: "already_linked",
    });
    expect(await measurements(database)).toHaveLength(1);
  });
});

describe("a refused link (S4, R-06)", () => {
  it("refuses a sample of another lab as unknown, storing nothing", async () => {
    const { database, w, uploadId } = await open();
    const refused = await link(database, w, {
      ...linkOf(w, uploadId),
      links: [{ well: "C3", labNumber: w.foreign.labNumber }],
    });
    expect(refused).toEqual({
      ok: false,
      error: "plate_refused",
      refusals: [{ code: "sample_unknown", well: "C3" }],
    });
    await nothingStored(database);
    expect((await auditRows(database, "upload_validation_fail")).map((r) => r.reason_code)).toEqual(
      ["plate_refused"],
    );
  });

  it("returns every link refusal together, a raw well position as sent", async () => {
    const { database, w, uploadId } = await open();
    const refused = await link(database, w, {
      ...linkOf(w, uploadId),
      links: [
        { well: "A13", labNumber: w.a.labNumber },
        { well: "B2", labNumber: "" },
        { well: "B3", labNumber: withCheckDigit("999999999").slice(0, 9) },
      ],
    });
    expect(refused).toEqual({
      ok: false,
      error: "plate_refused",
      refusals: [
        { code: "well_outside_plate", position: "A13", index: 0 },
        { code: "lab_number_missing", well: "B2" },
        { code: "lab_number_invalid", well: "B3" },
      ],
    });
    await nothingStored(database);
  });

  it.each([
    [
      "a second result for one sample and test",
      (w: UploadWorld) => [
        { labNumber: w.a.labNumber, testId: w.teamTest, value: "5.1" },
        { labNumber: w.a.labNumber, testId: w.teamTest, value: "5.2" },
      ],
      [{ code: "result_duplicate", index: 1 }],
    ],
    [
      "a sample no well holds",
      (w: UploadWorld) => [{ labNumber: w.first.labNumber, testId: w.teamTest, value: "5.1" }],
      [{ code: "sample_not_linked", index: 0 }],
    ],
    [
      "a sample of another lab",
      (w: UploadWorld) => [{ labNumber: w.foreign.labNumber, testId: w.teamTest, value: "5.1" }],
      [{ code: "sample_not_linked", index: 0 }],
    ],
    [
      "a test its request lacks",
      (w: UploadWorld) => [{ labNumber: w.a.labNumber, testId: w.crp, value: "5.1" }],
      [{ code: "test_not_requested", index: 0 }],
    ],
    [
      "a test entered by hand (D9)",
      (w: UploadWorld) => [{ labNumber: w.a.labNumber, testId: w.hba1c, value: "5.1" }],
      [{ code: "not_upload_test", index: 0 }],
    ],
    [
      "a test eduLIMS calculates (D9, #278)",
      (w: UploadWorld) => [{ labNumber: w.a.labNumber, testId: w.edulimsTest, value: "5.1" }],
      [{ code: "calculated_by_edulims", index: 0 }],
    ],
    [
      "a value in exponent form",
      (w: UploadWorld) => [{ labNumber: w.a.labNumber, testId: w.teamTest, value: "5e1" }],
      [{ code: "value_invalid", index: 0 }],
    ],
    [
      "a value past the bounds",
      (w: UploadWorld) => [{ labNumber: w.a.labNumber, testId: w.teamTest, value: "1000000000" }],
      [{ code: "value_invalid", index: 0 }],
    ],
  ])("refuses %s, storing nothing", async (_, results, expected) => {
    const { database, w, uploadId } = await open();
    expect(await link(database, w, { ...linkOf(w, uploadId), results: results(w) })).toEqual({
      ok: false,
      error: "results_refused",
      refusals: expected,
    });
    await nothingStored(database);
    expect((await auditRows(database, "upload_validation_fail")).map((r) => r.reason_code)).toEqual(
      ["results_refused"],
    );
  });
});

describe("who may link (S10, E1; security review of #372, V8.2.2)", () => {
  it("refuses a student of lab B posting lab A's id not_found, logged", async () => {
    const { database, w, uploadId } = await open();
    const lines = await securityLines(async () => {
      expect(await link(database, w, linkOf(w, uploadId), w.otherLabStudent)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
    expect(lines).toEqual([notFoundLine(w.otherLabStudent.id, "lab", w.labId)]);
    await nothingStored(database);
  });

  it("refuses a student of lab B posting lab A's upload under lab B's id", async () => {
    const { database, w, uploadId } = await open();
    expect(
      await link(
        database,
        w,
        { ...linkOf(w, uploadId), labId: w.otherLabId, links: [], results: [] },
        w.otherLabStudent,
      ),
    ).toEqual({ ok: false, error: "upload_not_found" });
    await nothingStored(database);
  });

  it.each([
    ["a teacher of the simulation", "teacher"],
    ["a teacher of another simulation", "outsiderTeacher"],
    ["an administrator who is no member", "admin"],
  ] as const)("refuses %s with 403", async (_, who) => {
    const { database, w, uploadId } = await open();
    await expect(link(database, w, linkOf(w, uploadId), w[who])).rejects.toThrow(AuthError);
    await nothingStored(database);
  });

  it("refuses a member once the simulation finished, logged not_running", async () => {
    const { database, w, uploadId } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await link(database, w, linkOf(w, uploadId))).toEqual({
      ok: false,
      error: "not_running",
    });
    await nothingStored(database);
  });

  it("refuses malformed ids", async () => {
    const { database, w, uploadId } = await open();
    expect(await link(database, w, { ...linkOf(w, uploadId), labId: "x" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await link(database, w, { ...linkOf(w, "x") })).toEqual({
      ok: false,
      error: "upload_not_found",
    });
  });
});

describe("a full plate (S4, Q-PERF-2)", () => {
  it("links 96 wells and stores the result within 10 seconds (one link, no load)", async () => {
    const { database, w, uploadId } = await open();
    const links = (await database.selectFrom("upload_wells").select("well").execute()).map(
      ({ well }, index) => ({
        well,
        labNumber: index % 2 === 0 ? w.a.labNumber : w.b.labNumber,
      }),
    );
    const started = performance.now();
    const linked = await link(database, w, {
      ...linkOf(w, uploadId),
      links,
      results: [
        { labNumber: w.a.labNumber, testId: w.teamTest, value: "5.25" },
        { labNumber: w.b.labNumber, testId: w.teamTest, value: "6.5" },
      ],
    });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(linked.ok).toBe(true);
    expect(await linkedWells(database)).toHaveLength(96);
  });
});
