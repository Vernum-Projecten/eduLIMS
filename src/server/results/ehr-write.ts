// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The released result in the patient's record (S15, #148). Before the release, the patient's EHR
// must exist, or the release is refused (`ehr_pending`). The release commits a pending
// `result_ehr_writes` row with it; after the commit eduLIMS writes the Final composition and
// marks the row written. A write that fails, or runs past its budget, leaves the row pending, and
// the retry schedule takes it up with a growing pause: never skipped, never reported as written.
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
import { findStudentLab } from "../simulations/student-access.ts";
import { done, type ResultsActor, type ResultsResult, refused } from "./access.ts";

/** Where a released result stands in the patient's record, as the release reports it. */
export type ResultEhrState = PatientRecordState;

/** What a write needs: the database, the FerroEHR client and the write settings. */
export interface ResultWriteDeps {
  db: Kysely<DB>;
  client: PatientEhrClient & LabResultClient;
  settings: LabResultWriteSettings;
  /** Returns the device of a released measurement; {@link deviceOfSource} when left out. */
  resolveDevice?: (measurement: { id: MeasurementId; source: MeasurementSource }) => ResultDevice;
}

// NOTE: no openEHR spec governs these: our own design (#148). The release waits at most 5 s for
// the EHR and 5 s for the write; the schedule leases a row for 5 minutes and pauses after the
// n-th failure 2^n minutes, at most an hour.
export const RELEASE_EHR_BUDGET_MS = 5_000;
export const RESULT_WRITE_BUDGET_MS = 5_000;
export const RESULT_WRITE_BATCH = 20;
const LEASE = sql`interval '5 minutes'`;
const MAX_PAUSE_MINUTES = 60;

/**
 * Makes sure the patient of a patient request has its EHR before the release (#148, #364): a
 * member's request whose EHR stays pending is refused `ehr_pending` with an activity-log row.
 * Anything else passes on to the release, which checks the lab and the request itself.
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
  const lab = await findStudentLab(db, actor.id, input.labId);
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
 * or `pending` when it failed or ran past `budgetMs`. A write past the budget runs on and records
 * its own outcome; an unexpected error is logged as `ferroehr_result_failed` and leaves it pending.
 */
export async function writeReleasedResult(
  deps: ResultWriteDeps,
  measurementId: MeasurementId,
  options: { budgetMs?: number } = { budgetMs: RESULT_WRITE_BUDGET_MS },
): Promise<"written" | "pending"> {
  const attempt = attemptWrite(deps, measurementId).catch((error: unknown) => {
    // NOTE: #148; the release has committed, so an error must not undo it or reach the team as a
    // failed release: the row stays pending and the schedule tries again.
    logFailure("ferroehr_result_failed", error, {
      target_type: "measurement",
      target_id: measurementId,
    });
    return "pending" as const;
  });
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
 * Takes up to `limit` pending writes whose pause is over, leases each, and writes them one by one
 * (the retry schedule). Returns how many it wrote and how many stay pending.
 */
export async function runPendingResultWrites(
  deps: ResultWriteDeps,
  limit: number = RESULT_WRITE_BATCH,
): Promise<{ written: number; pending: number }> {
  const claimed = await sql<{ measurement_id: string }>`
    update result_ehr_writes set next_attempt_at = now() + ${LEASE}
    where measurement_id in (
      select measurement_id from result_ehr_writes
      where state = 'pending' and next_attempt_at <= now()
      order by next_attempt_at, measurement_id
      limit ${limit}
      for update skip locked)
    returning measurement_id`.execute(deps.db);
  const tally = { written: 0, pending: 0 };
  const ids = claimed.rows.map((row) => row.measurement_id).toSorted();
  for (const id of ids) {
    const measurementId = parseMeasurementId(id);
    if (measurementId === null) throw new Error(`result write ${id} has no measurement id`);
    tally[await writeReleasedResult(deps, measurementId, {})] += 1;
  }
  return tally;
}

/** The released measurement as the write needs it, with the state of its write. */
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
    .select([
      "w.state",
      "m.source",
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
 * Returns the device of a measurement from its source alone (D9): `manual`, or the analyser
 * without its serial number, which a measurement does not record yet.
 */
export function deviceOfSource(measurement: { source: MeasurementSource }): ResultDevice {
  // TODO(#158): the Afinion 2 route records the analyser's serial number, and TODO(#152) the
  // Epoch 2 upload; until then such a result stays pending with `build:no_device_identifier`.
  switch (measurement.source) {
    case "afinion":
      return { kind: "afinion_2", serialNumber: null };
    case "epoch_upload":
      return { kind: "epoch_2", serialNumber: null };
    case "manual":
      return { kind: "manual" };
    default: {
      const unhandled: never = measurement.source;
      return unhandled;
    }
  }
}

/** One attempt: the EHR, the composition, and the row marked written or failed. */
async function attemptWrite(
  deps: ResultWriteDeps,
  measurementId: MeasurementId,
): Promise<"written" | "pending"> {
  const row = await loadRelease(deps.db, measurementId);
  if (!row) throw new Error(`no released result to write for measurement ${measurementId}`);
  if (row.state === "written") return "written";
  const patientId = row.patient_id === null ? null : parsePatientId(row.patient_id);
  const requestId = parseRequestId(row.request_id);
  if (patientId === null || requestId === null || row.released_at === null) {
    throw new Error(`measurement ${measurementId} is no released result of a patient`);
  }
  const source = parseMeasurementSource(row.source);
  if (source === undefined) throw new Error(`measurement ${measurementId} has an unknown source`);
  const ehr = await ensurePatientEhr(deps.db, deps.client, patientId);
  if (ehr.state === "pending") return failed(deps.db, measurementId, "ehr_pending");
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
      device: (deps.resolveDevice ?? deviceOfSource)({ id: measurementId, source }),
      releasedAt: row.released_at.toISOString(),
    },
    deps.settings,
  );
  if (outcome.outcome === "failed") {
    return failed(deps.db, measurementId, errorCode(outcome.error), outcome.error);
  }
  await deps.db
    .updateTable("result_ehr_writes")
    .set({
      state: "written",
      version_uid: outcome.versionUid,
      written_at: sql`now()`,
      last_error: null,
    })
    .where("measurement_id", "=", measurementId)
    .where("state", "=", "pending")
    .execute();
  logSecurityEvent("info", "ferroehr_result_written", {
    outcome: "success",
    target_type: "measurement",
    target_id: measurementId,
    kind: outcome.committed,
  });
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

/** Records a failed attempt with its pause, logs it with ids only, and returns `pending`. */
async function failed(
  db: Kysely<DB>,
  measurementId: MeasurementId,
  code: string,
  error?: LabResultWriteError,
): Promise<"pending"> {
  await db
    .updateTable("result_ehr_writes")
    .set({
      attempts: sql`attempts + 1`,
      last_error: code,
      next_attempt_at: sql`now() + least(power(2, attempts) * interval '1 minute', ${sql.lit(MAX_PAUSE_MINUTES)} * interval '1 minute')`,
    })
    .where("measurement_id", "=", measurementId)
    .where("state", "=", "pending")
    .execute();
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
