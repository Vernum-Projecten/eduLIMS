// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A lab's Gen5 uploads (S4, S10, B4, #156): a member stores a checked plate with its 96 values
// and its registered reader (reads.ts reads it back). A refused file stores nothing but its
// activity-log row. The lab comes from the session user's own place in `lab_members`,
// never from the client alone; another lab and an unknown id both answer `not_found`, logged.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import type { RequestId, SampleId } from "../../lib/lab-records.ts";
import type { PlateColumn, PlateRow, WellId } from "../../lib/plate.ts";
import type { MeasurementId } from "../../lib/results.ts";
import { type LabId, parseLabId } from "../../lib/simulations.ts";
import { parseUploadId, type UploadId, type UploadResultRefusalCode } from "../../lib/uploads.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent, logRecordsProbe, type RecordsActor } from "../lab-records/access.ts";
import { logSecurityEvent } from "../security-log.ts";
import {
  findStudentLab,
  findWorkingStudentLab,
  type StudentLab,
} from "../simulations/student-access.ts";
import type { Gen5Error } from "./errors.ts";
import { parseGen5Export } from "./gen5.ts";
import { checkPlateLinks, type PlateLinkRefusal } from "./plate-links.ts";

/** Who acts: the session user, never an id from the request. */
export type UploadActor = RecordsActor;

/** Why an upload or its links were refused as a whole. */
export type UploadPlainError = "not_found" | "not_running" | "upload_not_found" | "already_linked";

/** One refused result of a linked plate, by its index in the list sent (S4, D9). */
export interface UploadResultRefusal {
  readonly code: UploadResultRefusalCode;
  readonly index: number;
}

/**
 * Why a file is refused: an error of the parser, or a reader the analyser register does not hold
 * as an Epoch 2 reader in use (maintainer on #400, S2).
 */
export type UploadFileError = Gen5Error | { readonly kind: "reader_not_registered" };

/** The outcome of an upload action: done, or refused with a code and the items in error. */
export type UploadOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: UploadPlainError }
  | {
      readonly ok: false;
      readonly error: "file_refused";
      readonly errors: readonly UploadFileError[];
    }
  | {
      readonly ok: false;
      readonly error: "plate_refused";
      readonly refusals: readonly PlateLinkRefusal[];
    }
  | {
      readonly ok: false;
      readonly error: "results_refused";
      readonly refusals: readonly UploadResultRefusal[];
    };

/** Returns a plain refusal. */
export function refusedUpload<T>(error: UploadPlainError): UploadOutcome<T> {
  return { ok: false, error };
}

/** One well of a stored plate, with the sample of the team's own lab it is linked to, if any. */
export interface UploadWellView {
  readonly well: WellId;
  readonly row: PlateRow;
  readonly column: PlateColumn;
  /** The absorbance as an exact decimal. */
  readonly absorbance: string;
  readonly sample: { readonly labNumber: string; readonly sampleNumber: string } | null;
}

/** A measurement that came from an upload: the team's own entered result (S4, S14). */
export interface UploadMeasurementView {
  readonly measurementId: MeasurementId;
  readonly labNumber: string;
  readonly testId: string;
  readonly value: string;
  readonly recordedAt: string;
}

/** A stored upload as the lab's members see it; nothing in it is a correct value (Q-SIM-1). */
export interface UploadView {
  readonly uploadId: UploadId;
  readonly uploadedAt: string;
  readonly readerSerialNumber: string;
  readonly wavelengthNm: number;
  readonly linkedAt: string | null;
  /** The 96 wells in reading order, A1 to H12. */
  readonly wells: readonly UploadWellView[];
  readonly measurements: readonly UploadMeasurementView[];
}

/** A sample of the actor's own lab, with the request it belongs to. */
export interface OwnSample {
  readonly id: SampleId;
  readonly labId: LabId;
  readonly labNumber: string;
  readonly sampleNumber: string;
  readonly requestId: RequestId;
}

/**
 * Writes an upload the student does not reach (or that does not exist) to the security stream
 * as `authz_fail` (ASVS V16.3.2): the actor's id and the upload id asked for.
 */
export function logUploadProbe(actorId: string, uploadId: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: "user",
    actor_id: actorId,
    target_type: "upload",
    target_id: uploadId,
    reason: "not_own_upload",
    status: 404,
  });
}

/** Writes the activity-log row of a refused upload or link, with ids and a code only (B4, E4). */
export async function recordUploadRefusal(
  trx: Transaction<DB>,
  actor: UploadActor,
  lab: StudentLab,
  reason: string,
  uploadId?: UploadId,
): Promise<void> {
  await recordAudit(trx, {
    action: "upload_validation_fail",
    actor: { type: "user", id: actor.id },
    outcome: "refused",
    reason,
    ...(uploadId === undefined ? {} : { target: { type: "upload", id: uploadId } }),
    metadata: { simulation_id: lab.simulationId, lab_id: lab.labId },
  });
}

/** The file a student sends: its name, read for its extension only, and its bytes. */
export interface Gen5File {
  readonly labId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** The identifier the composition gives a result entered by hand; never a reader's serial. */
const MANUAL_DEVICE_ID = "manual";

/**
 * Returns the register's Epoch 2 reader in use whose serial number the file names, locked
 * `FOR SHARE` so a retirement waits, or `null` (maintainer on #400, S2). The identifier of the
 * manual-entry device is never a reader.
 */
async function registeredReader(
  trx: Transaction<DB>,
  serialNumber: string,
): Promise<{ id: string; serialNumber: string } | null> {
  if (serialNumber.toLowerCase() === MANUAL_DEVICE_ID) return null;
  const row = await trx
    .selectFrom("analysers")
    .select(["id", "serial_number"])
    .where("route", "=", "excel_upload")
    .where("status", "=", "in_use")
    .where("serial_number", "=", serialNumber)
    .forShare()
    .executeTakeFirst();
  return row ? { id: row.id, serialNumber: row.serial_number } : null;
}

/** Refuses a member whose simulation does not run, or anyone else, before a byte is parsed. */
async function refuseBeforeParse(
  db: Kysely<DB>,
  actor: UploadActor,
  labId: string,
): Promise<UploadOutcome<UploadView>> {
  return db.transaction().execute(async (trx) => {
    const member = await findStudentLab(trx, actor.id, labId);
    if (member === null) {
      logRecordsProbe(actor.id, "lab", labId);
      return refusedUpload<UploadView>("not_found");
    }
    await recordUploadRefusal(trx, actor, member, "not_running");
    return refusedUpload<UploadView>("not_running");
  });
}

/**
 * Stores a Gen5 export for the student's own lab (S4, S10, B4): the 96 values and the registered
 * Epoch 2 reader whose serial number the file names, with an `upload_complete` row. A refused file
 * (a parser error, a reader not in the register) stores nothing but an `upload_validation_fail`
 * row with its first reason, and returns every error found.
 *
 * The membership and the running simulation are checked before the file is parsed, and again,
 * locked, as the first statement of the writing transaction, so a finish or a move that commits
 * first wins.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function storeGen5Upload(
  db: Kysely<DB>,
  actor: UploadActor,
  file: Gen5File,
): Promise<UploadOutcome<UploadView>> {
  assertStudent(actor);
  if (parseLabId(file.labId) === null) {
    logRecordsProbe(actor.id, "lab", file.labId);
    return refusedUpload("not_found");
  }
  if ((await findWorkingStudentLab(db, actor.id, file.labId)) === null) {
    return refuseBeforeParse(db, actor, file.labId);
  }
  // NOTE: ASVS V15.2.2, #156; the parse is synchronous, so one process parses one file at a
  // time, and it runs outside the transaction, so no lock waits on it.
  const parsed = parseGen5Export({ fileName: file.fileName, bytes: file.bytes });
  return db.transaction().execute(async (trx): Promise<UploadOutcome<UploadView>> => {
    const lab = await findWorkingStudentLab(trx, actor.id, file.labId);
    if (lab === null) {
      const member = await findStudentLab(trx, actor.id, file.labId);
      if (member === null) {
        logRecordsProbe(actor.id, "lab", file.labId);
        return refusedUpload("not_found");
      }
      await recordUploadRefusal(trx, actor, member, "not_running");
      return refusedUpload("not_running");
    }
    if (!parsed.ok) {
      await recordUploadRefusal(trx, actor, lab, parsed.errors[0].kind);
      return { ok: false, error: "file_refused", errors: parsed.errors };
    }
    const { header } = parsed.plate;
    const reader = await registeredReader(trx, header.readerSerialNumber);
    if (reader === null) {
      await recordUploadRefusal(trx, actor, lab, "reader_not_registered");
      return { ok: false, error: "file_refused", errors: [{ kind: "reader_not_registered" }] };
    }
    const checked = checkPlateLinks({
      labId: lab.labId,
      plate: parsed.plate,
      links: [],
      samples: [],
    });
    if (!checked.ok) {
      await recordUploadRefusal(trx, actor, lab, checked.refusals[0].code);
      return { ok: false, error: "plate_refused", refusals: checked.refusals };
    }
    const row = await trx
      .insertInto("uploads")
      .values({
        simulation_id: lab.simulationId,
        lab_id: lab.labId,
        uploaded_by: actor.id,
        analyser_id: reader.id,
        wavelength_nm: header.wavelengthNm,
      })
      .returning(["id", "uploaded_at"])
      .executeTakeFirstOrThrow();
    const uploadId = parseUploadId(row.id);
    if (uploadId === null) throw new Error("the database returned a malformed upload id");
    await trx
      .insertInto("upload_wells")
      .values(
        checked.wells.map(({ well, absorbance }) => ({
          upload_id: uploadId,
          lab_id: lab.labId,
          well,
          absorbance,
        })),
      )
      .execute();
    await recordAudit(trx, {
      action: "upload_complete",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "upload", id: uploadId },
      metadata: { simulation_id: lab.simulationId, lab_id: lab.labId },
    });
    return {
      ok: true,
      value: {
        uploadId,
        uploadedAt: row.uploaded_at.toISOString(),
        readerSerialNumber: reader.serialNumber,
        wavelengthNm: header.wavelengthNm,
        linkedAt: null,
        wells: checked.wells.map(({ well, row: plateRow, column, absorbance }) => ({
          well,
          row: plateRow,
          column,
          absorbance,
          sample: null,
        })),
        measurements: [],
      },
    };
  });
}
