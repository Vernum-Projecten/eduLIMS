// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Migration 0027_gen5_uploads (#156, S4, S10, S14): the database holds what the upload service
// checks, so a write around the service is refused too, and `down` reverts it.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { link, linkOf, uploaded, uploadWorld } from "../upload/test-helpers.ts";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

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
  /** Runs `query` in a savepoint, so its refusal leaves the test transaction usable. */
  const refused = (query: ReturnType<typeof sql>) =>
    database.transaction().execute((trx) => query.execute(trx));
  return { database, w, uploadId, refused };
}

describe("0027_gen5_uploads", () => {
  it("refuses a well linked to a sample of another lab (S10, R-06)", async () => {
    const { w, uploadId, refused } = await open();
    await expect(
      refused(sql`update upload_wells set sample_id = ${w.foreign.id}
        where upload_id = ${uploadId} and well = 'A1'`),
    ).rejects.toThrow(/upload_wells_sample_fkey/);
  });

  it("keeps a well's value and refuses its removal (S4)", async () => {
    const { uploadId, refused } = await open();
    await expect(
      refused(sql`update upload_wells set absorbance = 1 where upload_id = ${uploadId}`),
    ).rejects.toThrow(/never changes once linked/);
    await expect(
      refused(sql`delete from upload_wells where upload_id = ${uploadId}`),
    ).rejects.toThrow(/never removed/);
  });

  it("refuses a change of a well once its upload is linked", async () => {
    const { database, w, uploadId, refused } = await open();
    await link(database, w, linkOf(w, uploadId));
    await expect(
      refused(sql`update upload_wells set sample_id = ${w.b.id}
        where upload_id = ${uploadId} and well = 'H12'`),
    ).rejects.toThrow(/never changes once linked/);
  });

  it("takes the upload's time from the database clock and sets its link once (Q-SIM-2)", async () => {
    const { database, w, uploadId, refused } = await open();
    const row = await database
      .insertInto("uploads")
      .values({
        simulation_id: w.simulationId,
        lab_id: w.labId,
        reader_serial_number: "INV001",
        wavelength_nm: 450,
        uploaded_at: new Date("2000-01-01T00:00:00Z"),
        linked_at: new Date("2000-01-01T00:00:00Z"),
      })
      .returning(["uploaded_at", "linked_at"])
      .executeTakeFirstOrThrow();
    expect(row.uploaded_at.getFullYear()).toBeGreaterThan(2000);
    expect(row.linked_at).toBeNull();
    await expect(
      refused(sql`update uploads set reader_serial_number = 'OTHER' where id = ${uploadId}`),
    ).rejects.toThrow(/an upload never changes/);
    await link(database, w, linkOf(w, uploadId));
    await expect(
      refused(sql`update uploads set linked_at = now() - interval '1 day' where id = ${uploadId}`),
    ).rejects.toThrow(/set once/);
    await expect(refused(sql`delete from uploads where id = ${uploadId}`)).rejects.toThrow(
      /never removed/,
    );
  });

  it("names the student of an Epoch 2 result, and no student of an Afinion one (maintainer on #400)", async () => {
    const { database, w, uploadId, refused } = await open();
    const insert = (source: string, testId: string, upload: string | null) =>
      refused(sql`insert into measurements (simulation_id, lab_id, request_id, test_id,
          sample_id, value, source, upload_id, recorded_by)
        values (${w.simulationId}, ${w.labId}, ${w.epochRequestId}, ${testId}, ${w.a.id}, 5.5,
          ${source}, ${upload}, ${w.student.id})`);
    await expect(insert("epoch_upload", w.teamTest, uploadId)).resolves.toBeDefined();
    await expect(insert("afinion", w.teamTest, null)).rejects.toThrow(/measurements_recorded_by/);
    const down = await createMigrator(database).migrateTo("0026_one_active_simulation_per_student");
    expect(down.error).toBeUndefined();
    const rows = await sql<{ recorded_by: string | null }>`
      select recorded_by from measurements where source = 'epoch_upload'`.execute(database);
    // The down step drops the student it cannot keep; the test's rollback undoes the rest.
    expect(rows.rows).toEqual([{ recorded_by: null }]);
  });

  it("ties an Epoch 2 measurement, and only it, to an upload of its own lab (S14)", async () => {
    const { database, w, uploadId, refused } = await open();
    const insert = (source: string, upload: string | null) =>
      refused(sql`insert into measurements
        (simulation_id, lab_id, request_id, test_id, sample_id, value, source, upload_id)
        values (${w.simulationId}, ${w.labId}, ${w.epochRequestId}, ${w.teamTest}, ${w.a.id},
          5.5, ${source}, ${upload})`);
    await expect(insert("epoch_upload", null)).rejects.toThrow(/measurements_upload/);
    await expect(insert("manual", uploadId)).rejects.toThrow(/measurements_upload/);
    const otherUpload = await uploaded(database, w.otherLabStudent, w.otherLabId);
    await expect(insert("epoch_upload", otherUpload)).rejects.toThrow(/measurements_upload_fkey/);
    await link(database, w, linkOf(w, uploadId));
    await expect(
      refused(
        sql`update measurements set upload_id = ${otherUpload} where upload_id = ${uploadId}`,
      ),
    ).rejects.toThrow(/never changes|measurements_upload_fkey/);
  });

  it("removes a lab's uploads with the lab", async () => {
    const { database, w, uploadId } = await open();
    await link(database, w, linkOf(w, uploadId));
    await sql`delete from labs where id = ${w.labId}`.execute(database);
    const left = await database.selectFrom("uploads").select("id").execute();
    expect(left).toEqual([]);
  });

  it("removes a simulation's uploads with the simulation", async () => {
    const { database, w, uploadId } = await open();
    await link(database, w, linkOf(w, uploadId));
    await uploaded(database, w.otherLabStudent, w.otherLabId);
    await sql`delete from simulations where id = ${w.simulationId}`.execute(database);
    const wells = await database.selectFrom("upload_wells").select("well").execute();
    expect(wells).toEqual([]);
  });

  it("reverts", async () => {
    const { database } = await open();
    const down = await createMigrator(database).migrateTo("0026_one_active_simulation_per_student");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0027_gen5_uploads", "Success"],
    ]);
    const tables = (await database.introspection.getTables()).map((t) => t.name);
    expect(tables).not.toContain("uploads");
    expect(tables).not.toContain("upload_wells");
    expect((await createMigrator(database).migrateToLatest()).error).toBeUndefined();
  });
});
