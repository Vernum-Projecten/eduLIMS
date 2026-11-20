// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The storing and the reading of a lab's Gen5 uploads (S4, S10, B4, Q-PERF-2, #156): a member
// stores the supplied export, every member reads it back, a refused file leaves no value, and
// every other caller is refused, logged with ids only.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW, notFoundLine, securityLines } from "../simulations/test-helpers.ts";
import { AIR_FILE, gen5Fixture, type UploadWorld, uploaded, uploadWorld } from "./test-helpers.ts";
import { readGen5Upload, storeGen5Upload } from "./uploads.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: UploadWorld }> {
  const database = await createTestDb();
  db = database;
  return { database, w: await uploadWorld(database) };
}

async function storedCounts(database: Kysely<DB>) {
  const uploads = await database.selectFrom("uploads").select("id").execute();
  const wells = await database.selectFrom("upload_wells").select("well").execute();
  return { uploads: uploads.length, wells: wells.length };
}

describe("storing the supplied export (S4, B4)", () => {
  it("keeps the 96 values in reading order and the reader's serial number", async () => {
    const { database, w } = await open();
    const stored = await storeGen5Upload(database, w.student, {
      labId: w.labId,
      fileName: AIR_FILE,
      bytes: gen5Fixture(),
    });
    if (!stored.ok) throw new Error(stored.error);
    expect(stored.value).toMatchObject({
      readerSerialNumber: "2204112B",
      wavelengthNm: 750,
      linkedAt: null,
      measurements: [],
    });
    expect(stored.value.wells).toHaveLength(96);
    expect(stored.value.wells[0]).toEqual({
      well: "A1",
      row: "A",
      column: 1,
      absorbance: "0.042",
      sample: null,
    });
    expect(stored.value.wells[95]?.well).toBe("H12");
    expect(await storedCounts(database)).toEqual({ uploads: 1, wells: 96 });
  });

  it("logs the upload with the uploader, the lab, the simulation and the verdict (B4)", async () => {
    const { database, w } = await open();
    const uploadId = await uploaded(database, w.student, w.labId);
    expect(await auditRows(database, "upload_complete")).toEqual([
      {
        actor_id: w.student.id,
        outcome: "success",
        target_type: "upload",
        target_id: uploadId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, lab_id: w.labId },
      },
    ]);
  });

  it("takes the time of the upload from the database clock (Q-SIM-2)", async () => {
    const { database, w } = await open();
    const before = await database
      .selectNoFrom((eb) => eb.fn<Date>("clock_timestamp").as("now"))
      .executeTakeFirstOrThrow();
    const uploadId = await uploaded(database, w.student, w.labId);
    const row = await database
      .selectFrom("uploads")
      .select("uploaded_at")
      .where("id", "=", uploadId)
      .executeTakeFirstOrThrow();
    expect(row.uploaded_at.getTime()).toBeGreaterThanOrEqual(before.now.getTime());
  });

  it("shows a full plate within 10 seconds (S4, Q-PERF-2; one upload, no load)", async () => {
    const { database, w } = await open();
    const started = performance.now();
    const uploadId = await uploaded(database, w.student, w.labId);
    const read = await readGen5Upload(database, w.labStudents[1] ?? w.student, {
      labId: w.labId,
      uploadId,
    });
    expect(read.ok && read.value.wells).toHaveLength(96);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("a refused file (S4)", () => {
  it("leaves no value behind and logs its first reason", async () => {
    const { database, w } = await open();
    const refused = await storeGen5Upload(database, w.student, {
      labId: w.labId,
      fileName: "plate.xlsx",
      bytes: new TextEncoder().encode("well,value\nA1,0.042\n"),
    });
    expect(refused).toMatchObject({ ok: false, error: "file_refused" });
    expect(await storedCounts(database)).toEqual({ uploads: 0, wells: 0 });
    const rows = await auditRows(database, "upload_validation_fail");
    expect(rows).toEqual([
      {
        actor_id: w.student.id,
        outcome: "refused",
        target_type: null,
        target_id: null,
        reason_code: expect.stringMatching(/^[a-z_]+$/),
        metadata: { simulation_id: w.simulationId, lab_id: w.labId },
      },
    ]);
  });

  it("refuses a file in another extension, naming the reason", async () => {
    const { database, w } = await open();
    const refused = await storeGen5Upload(database, w.student, {
      labId: w.labId,
      fileName: "plate.csv",
      bytes: gen5Fixture(),
    });
    expect(refused).toEqual({
      ok: false,
      error: "file_refused",
      errors: [{ kind: "wrong_extension" }],
    });
    expect(await storedCounts(database)).toEqual({ uploads: 0, wells: 0 });
  });
});

describe("who may upload (S10, E1)", () => {
  it("refuses a student of another lab not_found, logged, with nothing stored", async () => {
    const { database, w } = await open();
    const lines = await securityLines(async () => {
      expect(
        await storeGen5Upload(database, w.otherLabStudent, {
          labId: w.labId,
          fileName: AIR_FILE,
          bytes: gen5Fixture(),
        }),
      ).toEqual({ ok: false, error: "not_found" });
    });
    expect(lines).toEqual([notFoundLine(w.otherLabStudent.id, "lab", w.labId)]);
    expect(await storedCounts(database)).toEqual({ uploads: 0, wells: 0 });
  });

  it("refuses a malformed lab id not_found", async () => {
    const { database, w } = await open();
    expect(
      await storeGen5Upload(database, w.student, {
        labId: "not-a-uuid",
        fileName: AIR_FILE,
        bytes: gen5Fixture(),
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    ["a teacher of the simulation", "teacher"],
    ["a teacher of another simulation", "outsiderTeacher"],
    ["an administrator", "admin"],
  ] as const)("refuses %s with 403", async (_, who) => {
    const { database, w } = await open();
    await expect(
      storeGen5Upload(database, w[who], {
        labId: w.labId,
        fileName: AIR_FILE,
        bytes: gen5Fixture(),
      }),
    ).rejects.toThrow(AuthError);
    expect(await storedCounts(database)).toEqual({ uploads: 0, wells: 0 });
  });

  it("refuses a member once the simulation finished, logged not_running", async () => {
    const { database, w } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(
      await storeGen5Upload(database, w.student, {
        labId: w.labId,
        fileName: AIR_FILE,
        bytes: gen5Fixture(),
      }),
    ).toEqual({ ok: false, error: "not_running" });
    expect(await storedCounts(database)).toEqual({ uploads: 0, wells: 0 });
    expect((await auditRows(database, "upload_validation_fail")).map((r) => r.reason_code)).toEqual(
      ["not_running"],
    );
  });
});

describe("who may read an upload (S10)", () => {
  it("shows every member of the lab the upload and its values", async () => {
    const { database, w } = await open();
    const uploadId = await uploaded(database, w.student, w.labId);
    for (const member of w.labStudents) {
      const read = await readGen5Upload(database, member, { labId: w.labId, uploadId });
      expect(read.ok && read.value.wells.map((well) => well.absorbance)).toHaveLength(96);
    }
  });

  it("refuses a student of another lab, with the lab's or their own id, logged", async () => {
    const { database, w } = await open();
    const uploadId = await uploaded(database, w.student, w.labId);
    const lines = await securityLines(async () => {
      for (const labId of [w.labId, w.otherLabId]) {
        expect(await readGen5Upload(database, w.otherLabStudent, { labId, uploadId })).toEqual({
          ok: false,
          error: "upload_not_found",
        });
      }
    });
    expect(lines).toEqual([
      expect.objectContaining({ event: "authz_fail", target_type: "upload", target_id: uploadId }),
      expect.objectContaining({ event: "authz_fail", target_type: "upload", target_id: uploadId }),
    ]);
  });

  it("refuses a student of another simulation and a student in no lab", async () => {
    const { database, w } = await open();
    const uploadId = await uploaded(database, w.student, w.labId);
    for (const who of [w.outsideStudent, w.stranger]) {
      expect(await readGen5Upload(database, who, { labId: w.labId, uploadId })).toEqual({
        ok: false,
        error: "upload_not_found",
      });
    }
  });

  it.each([
    ["a teacher of the simulation", "teacher"],
    ["a teacher of another simulation", "outsiderTeacher"],
    ["an administrator", "admin"],
  ] as const)("refuses %s with 403", async (_, who) => {
    const { database, w } = await open();
    const uploadId = await uploaded(database, w.student, w.labId);
    await expect(readGen5Upload(database, w[who], { labId: w.labId, uploadId })).rejects.toThrow(
      AuthError,
    );
  });

  it("refuses a malformed upload id", async () => {
    const { database, w } = await open();
    expect(await readGen5Upload(database, w.student, { labId: w.labId, uploadId: "x" })).toEqual({
      ok: false,
      error: "upload_not_found",
    });
  });
});
