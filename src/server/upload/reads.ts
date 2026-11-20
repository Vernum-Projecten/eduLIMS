// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reading a lab's Gen5 uploads (S4, S10, #156): every member of the lab reads an upload with its
// wells, their links and the measurements that came from it; anyone else gets `upload_not_found`.
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import { plateWells } from "../../lib/plate.ts";
import { parseMeasurementId } from "../../lib/results.ts";
import { type LabId, parseLabId } from "../../lib/simulations.ts";
import { parseUploadId, type UploadId } from "../../lib/uploads.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent } from "../lab-records/access.ts";
import { studentLabsQuery } from "../simulations/student-access.ts";
import {
  logUploadProbe,
  refusedUpload,
  type UploadActor,
  type UploadMeasurementView,
  type UploadOutcome,
  type UploadView,
  type UploadWellView,
} from "./uploads.ts";

/**
 * Returns one upload of the student's own lab with its wells, their links and the measurements
 * that came from it (S4, S10), or `upload_not_found` for an upload of another lab or none, logged.
 * Every member of the lab reads it, in a running simulation or not.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function readGen5Upload(
  db: Kysely<DB>,
  actor: UploadActor,
  input: { labId: string; uploadId: string },
): Promise<UploadOutcome<UploadView>> {
  assertStudent(actor);
  const labId = parseLabId(input.labId);
  const uploadId = parseUploadId(input.uploadId);
  if (labId === null || uploadId === null) {
    logUploadProbe(actor.id, input.uploadId);
    return refusedUpload("upload_not_found");
  }
  return db.transaction().execute(async (trx): Promise<UploadOutcome<UploadView>> => {
    const member = await studentLabsQuery(trx, actor.id)
      .innerJoin("uploads", (join) =>
        join
          .onRef("uploads.lab_id", "=", "labs.id")
          .onRef("uploads.simulation_id", "=", "labs.simulation_id"),
      )
      .select("uploads.id")
      .where("labs.id", "=", labId)
      .where("uploads.id", "=", uploadId)
      // NOTE: S4; a link holds the upload FOR UPDATE until it commits, so this read sees the
      // links, the measurements and the time of the link together, or none of them.
      .forShare(["uploads"])
      .executeTakeFirst();
    if (!member) {
      logUploadProbe(actor.id, uploadId);
      return refusedUpload("upload_not_found");
    }
    return { ok: true, value: await loadUploadView(trx, labId, uploadId) };
  });
}

/**
 * Returns an upload with its wells and measurements, for a caller that already reached it
 * through the lab's membership in `trx`.
 */
export async function loadUploadView(
  trx: Transaction<DB>,
  labId: LabId,
  uploadId: UploadId,
): Promise<UploadView> {
  const upload = await trx
    .selectFrom("uploads")
    .innerJoin("analysers", "analysers.id", "uploads.analyser_id")
    .select([
      "uploads.uploaded_at",
      "analysers.serial_number",
      "uploads.wavelength_nm",
      "uploads.linked_at",
    ])
    .where("uploads.id", "=", uploadId)
    .where("uploads.lab_id", "=", labId)
    .executeTakeFirstOrThrow();
  return {
    uploadId,
    uploadedAt: upload.uploaded_at.toISOString(),
    readerSerialNumber: upload.serial_number,
    wavelengthNm: upload.wavelength_nm,
    linkedAt: upload.linked_at?.toISOString() ?? null,
    wells: await uploadWells(trx, labId, uploadId),
    measurements: await uploadMeasurements(trx, labId, uploadId),
  };
}

/** Returns the wells of an upload the caller already reached through the lab's membership. */
async function uploadWells(
  trx: Transaction<DB>,
  labId: LabId,
  uploadId: UploadId,
): Promise<UploadWellView[]> {
  const rows = await trx
    .selectFrom("upload_wells as w")
    .leftJoin("samples as s", (join) =>
      join.onRef("s.id", "=", "w.sample_id").onRef("s.lab_id", "=", "w.lab_id"),
    )
    .select([
      "w.well",
      sql<string>`w.absorbance::text`.as("absorbance"),
      "s.lab_number",
      "s.sample_number",
    ])
    .where("w.upload_id", "=", uploadId)
    .where("w.lab_id", "=", labId)
    .orderBy("w.well")
    .execute();
  const byWell = new Map(rows.map((row) => [row.well, row]));
  return plateWells().map(({ well, row, column }) => {
    const stored = byWell.get(well);
    if (stored === undefined) throw new Error("a stored upload lacks a well");
    return {
      well,
      row,
      column,
      absorbance: stored.absorbance,
      sample:
        stored.lab_number === null || stored.sample_number === null
          ? null
          : { labNumber: stored.lab_number, sampleNumber: stored.sample_number },
    };
  });
}

/** Returns the measurements that came from an upload, oldest first. */
async function uploadMeasurements(
  trx: Transaction<DB>,
  labId: LabId,
  uploadId: UploadId,
): Promise<UploadMeasurementView[]> {
  const rows = await trx
    .selectFrom("measurements as m")
    .innerJoin("samples as s", "s.id", "m.sample_id")
    .select([
      "m.id",
      "s.lab_number",
      "m.test_id",
      sql<string>`m.value::text`.as("value"),
      "m.recorded_at",
    ])
    .where("m.upload_id", "=", uploadId)
    .where("m.lab_id", "=", labId)
    .orderBy("m.recorded_at")
    .orderBy("m.id")
    .execute();
  return rows.map((row) => {
    const measurementId = parseMeasurementId(row.id);
    if (measurementId === null) throw new Error("the database returned a malformed measurement id");
    return {
      measurementId,
      labNumber: row.lab_number,
      testId: row.test_id,
      value: row.value,
      recordedAt: row.recorded_at.toISOString(),
    };
  });
}
