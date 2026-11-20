// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The released result in the patient's record (S15, #148). Before the release, the patient's EHR
// must exist, or the release is refused (`ehr_pending`). The release commits a pending
// `result_ehr_writes` row with it; after the commit eduLIMS writes the Final composition and
// marks the row written. A write that fails, or runs past its budget, leaves the row pending, and
// the retry schedule takes it up with a growing pause: never skipped, never reported as written.
// Each attempt leases its row first and records its outcome under that lease (#382).
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { parsePatientId, parseRequestId } from "../../lib/lab-records.ts";
import {
  type MeasurementId,
  type MeasurementSource,
  type PatientRecordState,
  parseMeasurementId,
  parseMeasurementSource,
} from "../../lib/results.ts";
import { recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent } from "../lab-records/access.ts";
import { ensurePatientEhr, type PatientEhrClient } from "../lab-records/patient-ehr.ts";
import type { ResultDevice } from "../openehr/lab-result.ts";
import {
  type LabResultClient,
  type LabResultWriteError,
  type LabResultWriteSettings,
  writeFinalLabResult,
} from "../openehr/lab-result-writer.ts";
import { failureCause, logFailure, logSecurityEvent } from "../security-log.ts";
import { findWorkingStudentLab } from "../simulations/student-access.ts";
import { done, type ResultsActor, type ResultsResult, refused } from "./access.ts";
import {
  dueWrites,
  type ResultWriteLease,
  recordFailure,
  recordWritten,
  takeLease,
  writeState,
} from "./ehr-write-lease.ts";

/** What a released measurement records of the device that measured it. */
export interface ReleasedMeasurementDevice {
  id: MeasurementId;
  source: MeasurementSource;
  /** The reader's serial number from the header of the measurement's Gen5 upload (#156). */
  readerSerialNumber: string | null;
}

/** Where a released result stands in the patient's record, as the release reports it. */
export type ResultEhrState = PatientRecordState;

/** What a write needs: the database, the FerroEHR client and the write settings. */
export interface ResultWriteDeps {
  db: Kysely<DB>;
  client: PatientEhrClient & LabResultClient;
  settings: LabResultWriteSettings;
  /** Returns the device of a released measurement; {@link deviceOfSource} when left out. */
  resolveDevice?: (measurement: ReleasedMeasurementDevice) => ResultDevice;
}

// NOTE: no openEHR spec governs these: our own design (#148). The release waits at most 5 s for
// the EHR and 5 s for the write; a retry run takes up to 20 due writes, one lease at a time.
export const RELEASE_EHR_BUDGET_MS = 5_000;
export const RESULT_WRITE_BUDGET_MS = 5_000;
export const RESULT_WRITE_BATCH = 20;

/** The `last_error` of an attempt that threw, which is logged as `ferroehr_result_failed`. */
export const UNEXPECTED_ERROR_CODE = "unexpected";

/**
 * Makes sure the patient of a patient request has its EHR before the release (#148, #364): a
 * member's request in a running simulation whose EHR stays pending is refused `ehr_pending` with
 * an activity-log row. Anything else, a simulation that does not run included, passes on to the
 * release, which checks the lab and the request itself and refuses without asking FerroEHR.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function ensureReleaseEhr(
  db: Kysely<DB>,
  client: PatientEhrClient,
  actor: ResultsActor,
  input: { labId: string; requestId: string; testId: string },
): Promise<ResultsResult<null>> {
  assertStudent(actor);
  // NOTE: #382; only a member of a running simulation makes eduLIMS resolve an EHR, so a finished
  // one gets the release's `not_running` and FerroEHR is never asked.
  const lab = await findWorkingStudentLab(db, actor.id, input.labId);
  const requestId = parseRequestId(input.requestId);
  if (lab === null || requestId === null) return done(null);
  const request = await db
    .selectFrom("requests")
    .select("patient_id")
    .where("id", "=", requestId)
    .where("lab_id", "=", lab.labId)
    .executeTakeFirst();
  const patientId = request?.patient_id ? parsePatientId(request.patient_id) : null;
  if (patientId === null) return done(null);
  const ehr = await ensurePatientEhr(db, client, patientId, { budgetMs: RELEASE_EHR_BUDGET_MS });
  if (ehr.state === "ready") return done(null);
  await recordCommittedAudit(db, {
    action: "lab_result_released",
    actor: { type: "user", id: actor.id },
    target: { type: "lab", id: lab.labId },
    outcome: "refused",
    reason: "ehr_pending",
    metadata: { lab_request_id: requestId, test_id: input.testId },
  });
  return refused("ehr_pending");
}

/**
 * Writes the released result of `measurementId` to the patient's record and returns `written`,
 * or `pending` when it failed or ran past `budgetMs`. It leases the pending row whatever its
 * pause. A write past the budget runs on and records its own outcome; an unexpected error is
 * logged as `ferroehr_result_failed` and leaves it pending.
 */
export async function writeReleasedResult(
  deps: ResultWriteDeps,
  measurementId: MeasurementId,
  options: { budgetMs?: number } = { budgetMs: RESULT_WRITE_BUDGET_MS },
): Promise<"written" | "pending"> {
  const attempt = settle(
    measurementId,
    attemptWrite(deps, measurementId, { due: false }).then(async (outcome) => {
      if (outcome !== "not_leased") return outcome;
      const state = await writeState(deps.db, measurementId);
      if (state === undefined) throw new Error(`no result write for measurement ${measurementId}`);
      return state === "written" ? "written" : "pending";
    }),
  );
  if (options.budgetMs === undefined) return attempt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), options.budgetMs);
  });
  try {
    return await Promise.race([attempt, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Takes up to `limit` pending writes whose pause is over and writes them one by one, each under a
 * lease taken just before its attempt (the retry schedule). A row another run took in the
 * meantime is skipped. Returns how many it wrote and how many stay pending.
 */
export async function runPendingResultWrites(
  deps: ResultWriteDeps,
  limit: number = RESULT_WRITE_BATCH,
): Promise<{ written: number; pending: number }> {
  const tally = { written: 0, pending: 0 };
  for (const id of await dueWrites(deps.db, limit)) {
    const measurementId = parseMeasurementId(id);
    if (measurementId === null) throw new Error(`result write ${id} has no measurement id`);
    const outcome = await settle(measurementId, attemptWrite(deps, measurementId, { due: true }));
    if (outcome !== "not_leased") tally[outcome] += 1;
  }
  return tally;
}

/** Logs an error that escaped an attempt as `ferroehr_result_failed` and answers `pending`. */
function settle<T>(measurementId: MeasurementId, attempt: Promise<T>): Promise<T | "pending"> {
  return attempt.catch((error: unknown) => {
    // NOTE: #148; the release has committed, so an error must not undo it or reach the team as a
    // failed release: the row stays pending and the schedule tries again.
    logFailure("ferroehr_result_failed", error, {
      target_type: "measurement",
      target_id: measurementId,
    });
    return "pending" as const;
  });
}

/** The released measurement as the write needs it; `undefined` when no release names it. */
async function loadRelease(db: Kysely<DB>, measurementId: MeasurementId) {
  return db
    .selectFrom("result_ehr_writes as w")
    .innerJoin("measurements as m", "m.id", "w.measurement_id")
    .innerJoin("request_tests as rt", (join) =>
      join
        .onRef("rt.request_id", "=", "m.request_id")
        .onRef("rt.test_id", "=", "m.test_id")
        .onRef("rt.released_measurement_id", "=", "m.id"),
    )
    .innerJoin("requests as r", "r.id", "m.request_id")
    .innerJoin("samples as s", "s.id", "m.sample_id")
    .innerJoin("catalogue_tests as t", "t.id", "m.test_id")
    .leftJoin("uploads as u", (join) =>
      join.onRef("u.id", "=", "m.upload_id").onRef("u.lab_id", "=", "m.lab_id"),
    )
    .select([
      "m.source",
      "u.reader_serial_number",
      "m.recorded_at",
      sql<string>`m.value::text`.as("value"),
      "r.id as request_id",
      "r.patient_id",
      "r.requester",
      "s.lab_number",
      "s.sample_number",
      "s.material",
      "t.name",
      "t.unit",
      "t.afinion_analyte",
      "rt.released_at",
    ])
    .where("w.measurement_id", "=", measurementId)
    .executeTakeFirst();
}

/**
 * Returns the device of a measurement (D9): `manual`, the Epoch 2 by the reader's serial number
 * of its Gen5 upload (#156), or the Afinion 2 without its serial number, which an Afinion
 * measurement does not record yet.
 */
export function deviceOfSource(
  measurement: Pick<ReleasedMeasurementDevice, "source" | "readerSerialNumber">,
): ResultDevice {
  // TODO(#158): the Afinion 2 route records the analyser's serial number; until then such a
  // result stays pending with `build:no_device_identifier`.
  switch (measurement.source) {
    case "afinion":
      return { kind: "afinion_2", serialNumber: null };
    case "epoch_upload":
      return { kind: "epoch_2", serialNumber: measurement.readerSerialNumber };
    case "manual":
      return { kind: "manual" };
    default: {
      const unhandled: never = measurement.source;
      return unhandled;
    }
  }
}

/**
 * One attempt under a lease taken just before it: `not_leased` when the row is not pending (or,
 * with `due`, not due). An error inside it is recorded as {@link UNEXPECTED_ERROR_CODE} with its
 * pause, and passed on to be logged only when the row's error code changed.
 */
async function attemptWrite(
  deps: ResultWriteDeps,
  measurementId: MeasurementId,
  options: { due: boolean },
): Promise<"written" | "pending" | "not_leased"> {
  const lease = await takeLease(deps.db, measurementId, options);
  if (lease === null) return "not_leased";
  try {
    return await writeUnderLease(deps, measurementId, lease);
  } catch (error) {
    const recorded = await recordFailure(deps.db, measurementId, lease, UNEXPECTED_ERROR_CODE);
    // NOTE: #382; a write that keeps failing logs once per error code: the same error again is
    // counted on the row with its pause and not logged a second time.
    if (recorded !== "same") throw error;
    return "pending";
  }
}

/** The EHR, the composition, and the row marked written or failed, all under `lease`. */
async function writeUnderLease(
  deps: ResultWriteDeps,
  measurementId: MeasurementId,
  lease: ResultWriteLease,
): Promise<"written" | "pending"> {
  const fail = (code: string, error?: LabResultWriteError) =>
    failed(deps.db, measurementId, lease, code, error);
  const row = await loadRelease(deps.db, measurementId);
  if (!row) return fail("release:missing");
  const patientId = row.patient_id === null ? null : parsePatientId(row.patient_id);
  const requestId = parseRequestId(row.request_id);
  if (patientId === null || requestId === null || row.released_at === null) {
    return fail("release:no_patient");
  }
  const source = parseMeasurementSource(row.source);
  if (source === undefined) return fail("release:unknown_source");
  const ehr = await ensurePatientEhr(deps.db, deps.client, patientId);
  if (ehr.state === "pending") return fail("ehr_pending");
  const outcome = await writeFinalLabResult(
    deps.client,
    {
      ehrId: ehr.ehrId,
      measurementId,
      requestId,
      requester: row.requester,
      sample: {
        labNumber: row.lab_number,
        sampleNumber: row.sample_number,
        material: row.material,
      },
      test: { name: row.name, analyte: row.afinion_analyte ?? row.name, unit: row.unit },
      value: row.value,
      measuredAt: row.recorded_at.toISOString(),
      device: (deps.resolveDevice ?? deviceOfSource)({
        id: measurementId,
        source,
        readerSerialNumber: row.reader_serial_number,
      }),
      releasedAt: row.released_at.toISOString(),
    },
    deps.settings,
  );
  if (outcome.outcome === "failed") return fail(errorCode(outcome.error), outcome.error);
  // NOTE: #382; a lost lease means another run holds the row and finds this contribution by its
  // uid, so FerroEHR holds the result either way and only the holder records it.
  if (await recordWritten(deps.db, measurementId, lease, outcome.versionUid)) {
    logSecurityEvent("info", "ferroehr_result_written", {
      outcome: "success",
      target_type: "measurement",
      target_id: measurementId,
      kind: outcome.committed,
    });
  }
  return "written";
}

/** Returns the log-safe code of a failed write, as `last_error` stores it. */
export function errorCode(error: LabResultWriteError): string {
  switch (error.kind) {
    case "build":
      return `build:${error.reason}`;
    case "openehr": {
      const status = "status" in error.error ? `:${error.error.status}` : "";
      return `openehr:${error.error.kind}${status}`;
    }
    case "uid_conflict":
    case "foreign_contribution":
      return error.kind;
    default: {
      const unhandled: never = error;
      return String(unhandled);
    }
  }
}

/**
 * Records a failed attempt under `lease` with its pause, logs it with ids only when its error
 * code changed, and returns `pending`.
 */
async function failed(
  db: Kysely<DB>,
  measurementId: MeasurementId,
  lease: ResultWriteLease,
  code: string,
  error?: LabResultWriteError,
): Promise<"pending"> {
  if ((await recordFailure(db, measurementId, lease, code)) !== "changed") return "pending";
  const cause = error?.kind === "openehr" && "cause" in error.error ? error.error.cause : undefined;
  logSecurityEvent("error", "ferroehr_result_pending", {
    outcome: "failure",
    target_type: "measurement",
    target_id: measurementId,
    reason: code,
    cause: cause === undefined ? undefined : failureCause(cause),
  });
  return "pending";
}
