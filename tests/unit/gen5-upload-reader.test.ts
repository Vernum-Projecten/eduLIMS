// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// An Epoch 2 reader must be in the analyser register (maintainer on #400, S2): an upload whose
// serial number names no in-use reader of the Gen5 route stores nothing and is logged as a file
// refusal, and the identifier of the manual-entry device is never a reader. Invented files only.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { auditRows } from "../../src/server/simulations/test-helpers.ts";
import { registerReader, uploadWorld } from "../../src/server/upload/test-helpers.ts";
import { storeGen5Upload } from "../../src/server/upload/uploads.ts";
import { buildGen5Workbook, gen5Cells } from "../fixtures/gen5/xlsx-builder.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** A good invented export whose header names the reader `serial`. */
function exportOf(serial: string): Uint8Array {
  const cells = gen5Cells();
  cells.set("B10", serial);
  return buildGen5Workbook(cells);
}

async function upload(serial: string, prepare?: (database: Kysely<DB>) => Promise<unknown>) {
  const database = await createTestDb();
  db = database;
  const w = await uploadWorld(database);
  await prepare?.(database);
  const outcome = await storeGen5Upload(database, w.student, {
    labId: w.labId,
    fileName: "plate.xlsx",
    bytes: exportOf(serial),
  });
  const stored = await database.selectFrom("uploads").select("id").execute();
  const refusals = await auditRows(database, "upload_validation_fail");
  return { outcome, stored, refusals };
}

const REFUSED = {
  ok: false,
  error: "file_refused",
  errors: [{ kind: "reader_not_registered" }],
};

describe("the reader of an upload (maintainer on #400, S2)", () => {
  it("stores an upload from a registered Epoch 2 reader in use", async () => {
    const { outcome, stored } = await upload("INV0001", (database) =>
      registerReader(database, "INV0001"),
    );
    expect(outcome).toMatchObject({ ok: true, value: { readerSerialNumber: "INV0001" } });
    expect(stored).toHaveLength(1);
  });

  it("refuses a reader the register does not hold, storing nothing, logged", async () => {
    const { outcome, stored, refusals } = await upload("INV0002");
    expect(outcome).toEqual(REFUSED);
    expect(stored).toEqual([]);
    expect(refusals.map((row) => row.reason_code)).toEqual(["reader_not_registered"]);
  });

  it("refuses a reader in maintenance", async () => {
    const { outcome, stored } = await upload("INV0003", (database) =>
      registerReader(database, "INV0003", "maintenance"),
    );
    expect(outcome).toEqual(REFUSED);
    expect(stored).toEqual([]);
  });

  it("refuses a serial number registered for the HL7 route only", async () => {
    const { outcome } = await upload("INV0004", (database) =>
      database
        .insertInto("analysers")
        .values({
          model: "Afinion 2",
          serial_number: "INV0004",
          location: "Practice lab (invented)",
          route: "hl7_ferrobridge",
        })
        .execute(),
    );
    expect(outcome).toEqual(REFUSED);
  });

  it.each(["manual", "MANUAL"])(
    "refuses %s, the manual-entry device, even when registered",
    async (serial) => {
      const { outcome, stored, refusals } = await upload(serial, (database) =>
        registerReader(database, serial),
      );
      expect(outcome).toEqual(REFUSED);
      expect(stored).toEqual([]);
      expect(refusals.map((row) => row.reason_code)).toEqual(["reader_not_registered"]);
    },
  );
});
