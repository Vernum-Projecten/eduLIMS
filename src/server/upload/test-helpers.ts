// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the upload tests: the results world with two invented Epoch 2 tests (one the
// team calculates, one eduLIMS calculates) on a request of two samples, a sample of the other lab,
// and the supplied export of an empty plate. Every value is invented (Q-PRIV-4). Test support only.
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { patientIn, requestFor } from "../lab-records/test-helpers.ts";
import { resultsWorld } from "../results/test-helpers.ts";
import type { Person } from "../simulations/test-helpers.ts";
import { type LinkRequest, linkGen5Upload } from "./linking.ts";
import { storeGen5Upload } from "./uploads.ts";

/** The supplied export of an empty plate read at 750 nm (`tests/fixtures/gen5/README.md`). */
export const AIR_FILE = "epoch2-endpoint-750nm-air.xlsx";

/** The serial number in the header of the supplied export. */
export const AIR_READER_SERIAL = "2204112B";

/**
 * Registers an Epoch 2 reader in use with `serialNumber` (the register is the admin's, B3) and
 * returns its id; the supplied export's reader by default (maintainer on #400, S2).
 */
export async function registerReader(
  db: Kysely<DB>,
  serialNumber: string = AIR_READER_SERIAL,
  status: "in_use" | "maintenance" = "in_use",
): Promise<string> {
  const row = await db
    .insertInto("analysers")
    .values({
      model: "Epoch 2",
      serial_number: serialNumber,
      location: "Practice lab (invented)",
      route: "excel_upload",
      status,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Returns the bytes of a Gen5 fixture. */
export function gen5Fixture(name: string = AIR_FILE): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../../tests/fixtures/gen5/${name}`, import.meta.url)),
  );
}

async function epochTest(
  db: Kysely<DB>,
  name: string,
  calculatedBy: "team" | "edulims",
): Promise<string> {
  const row = await db
    .insertInto("catalogue_tests")
    .values({
      name,
      unit: "mmol/L",
      material: "plasma",
      source: "epoch_upload",
      epoch_calculated_by: calculatedBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * The results world plus `teamTest` and `edulimsTest` (Epoch 2) and the hand-entered HbA1c on
 * `epochRequestId`, with samples `a` and `b`; `foreign` is a sample of the other lab.
 */
export async function uploadWorld(db: Kysely<DB>) {
  const w = await resultsWorld(db);
  const readerId = await registerReader(db);
  const teamTest = await epochTest(db, "Glucose by plate (invented)", "team");
  const edulimsTest = await epochTest(db, "Protein by plate (invented)", "edulims");
  const request = await requestFor(
    db,
    w.student,
    w.labId,
    w.patientId,
    [teamTest, edulimsTest, w.hba1c],
    {
      samples: [
        { sampleNumber: "S-101", material: "plasma" },
        { sampleNumber: "S-102", material: "plasma" },
      ],
    },
  );
  const [a, b] = request.samples;
  if (!a || !b) throw new Error("no samples");
  const otherPatient = await patientIn(db, w.otherLabStudent, w.otherLabId);
  const other = await requestFor(db, w.otherLabStudent, w.otherLabId, otherPatient, [teamTest], {
    samples: [{ sampleNumber: "S-101", material: "plasma" }],
  });
  const [foreign] = other.samples;
  if (!foreign) throw new Error("no sample");
  return {
    ...w,
    readerId,
    teamTest,
    edulimsTest,
    epochRequestId: request.requestId,
    a,
    b,
    foreign,
  };
}

/** The world {@link uploadWorld} builds. */
export type UploadWorld = Awaited<ReturnType<typeof uploadWorld>>;

/** Stores the supplied export for `labId` as `actor` and returns the upload's id. */
export async function uploaded(
  db: Kysely<DB>,
  actor: Person,
  labId: string,
  bytes: Uint8Array = gen5Fixture(),
): Promise<string> {
  const stored = await storeGen5Upload(db, actor, { labId, fileName: AIR_FILE, bytes });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value.uploadId;
}

/** The link of wells A1 and A2 to sample `a`, B1 to `b`, and a result for `a` of the team test. */
export function linkOf(w: UploadWorld, uploadId: string): LinkRequest {
  return {
    labId: w.labId,
    uploadId,
    links: [
      { well: "A1", labNumber: w.a.labNumber },
      { well: "A2", labNumber: w.a.labNumber },
      { well: "B1", labNumber: w.b.labNumber },
    ],
    results: [{ labNumber: w.a.labNumber, testId: w.teamTest, value: "5.25" }],
  };
}

/** Links an upload as the world's first student and returns the outcome. */
export function link(db: Kysely<DB>, w: UploadWorld, request: LinkRequest, actor = w.student) {
  return linkGen5Upload(db, actor, request);
}
