// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements of a requested test (S14). Every measurement is a new row and none is changed or
// removed, so a team that measures again keeps both. Entry by hand is one route; the Afinion 2
// (#158) and the Epoch 2 upload (#152) write through the same `insertMeasurement`, which checks
// every precondition itself in the caller's transaction.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { parseDecimal } from "../../lib/decimal.ts";
import { parseRequestId, parseSampleId } from "../../lib/lab-records.ts";
import {
  type MeasurementId,
  type MeasurementSource,
  parseMeasurementId,
} from "../../lib/results.ts";
import type { AuditActor } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { logRecordsProbe } from "../lab-records/access.ts";
import {
  done,
  type ResultsActionError,
  type ResultsActor,
  type ResultsResult,
  refused,
  withResultsLab,
} from "./access.ts";

/** One measurement to store, from any route: where it belongs, its value and its source. */
export interface NewMeasurement {
  labId: string;
  requestId: string;
  testId: string;
  sampleId: string;
  /** The value as the route read it: parsed and bounded here, never trusted. */
  value: string;
  source: MeasurementSource;
  /** The student who entered it (by hand or as an Epoch 2 result), or `null` for the Afinion 2. */
  recordedBy: string | null;
  /**
   * Who acts, for the activity log: the session user of a student's route, eduLIMS itself for an
   * analyser's (security review of #400, N1). Separate from `recordedBy`, the stored column.
   */
  auditActor: AuditActor;
  /** The Gen5 upload of an `epoch_upload` measurement, of the same lab; `null` for any other. */
  uploadId?: string | null;
}

/** A stored measurement: its id and the database clock at the insert. */
export interface StoredMeasurement {
  measurementId: MeasurementId;
  recordedAt: string;
}

/** The activity-log row of a measurement, done or refused, with ids only (E4). */
function measurementEvent(measurement: NewMeasurement) {
  return {
    action: "lab_measurement_recorded",
    actor: measurement.auditActor,
    target: { type: "lab", id: measurement.labId },
  } as const;
}

/** Writes a refused measurement's activity-log row and returns the refusal. */
async function refuse<T>(
  trx: Transaction<DB>,
  measurement: NewMeasurement,
  reason: ResultsActionError,
): Promise<ResultsResult<T>> {
  await recordAudit(trx, {
    ...measurementEvent(measurement),
    outcome: "refused",
    reason,
    metadata: { test_id: measurement.testId },
  });
  return refused(reason);
}

/**
 * Stores one measurement of a requested test with its activity-log row (ids only, never the
 * value), after checking in `trx`, in this order:
 *
 * 1. the lab's simulation runs, its row locked `FOR SHARE` (`not_running`), so a finish waits;
 * 2. the request belongs to the lab, locked `FOR SHARE` (`request_not_found`), so a correction or
 *    a release serialises with the insert;
 * 3. the request names the test (`test_not_found`), and the measurement comes from the test's own
 *    source (`not_manual_test` for entry by hand, `source_mismatch` for an analyser; D9);
 * 4. entry by hand is refused once the requested test is released (`released`). An analyser
 *    result still lands and shows; the release stays final (maintainer on #370, Q1);
 * 5. the sample belongs to the request (`sample_not_found`);
 * 6. the value is a decimal within the bounds, no exponent form (`value_invalid`).
 *
 * Every refusal writes a refused activity-log row and stores no measurement. The caller matches
 * an analyser result to its sample by the lab number alone (maintainer on #270).
 */
export async function insertMeasurement(
  trx: Transaction<DB>,
  measurement: NewMeasurement,
): Promise<ResultsResult<StoredMeasurement>> {
  const lab = await trx
    .selectFrom("labs")
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .select(["labs.id", "labs.simulation_id", "simulations.state"])
    .where("labs.id", "=", measurement.labId)
    .forShare("simulations")
    .executeTakeFirst();
  if (!lab) return refused("not_found");
  if (lab.state !== "running") return refuse(trx, measurement, "not_running");
  const requestId = parseRequestId(measurement.requestId);
  const request =
    requestId === null
      ? undefined
      : await trx
          .selectFrom("requests")
          .select("id")
          .where("id", "=", requestId)
          .where("lab_id", "=", lab.id)
          .forShare()
          .executeTakeFirst();
  if (!request) {
    if (measurement.auditActor.type === "user") {
      logRecordsProbe(measurement.auditActor.id, "request", measurement.requestId);
    }
    return refused("request_not_found");
  }
  const requested = await trx
    .selectFrom("request_tests")
    .innerJoin("catalogue_tests", "catalogue_tests.id", "request_tests.test_id")
    .select(["request_tests.released_at", "catalogue_tests.source"])
    .where("request_tests.request_id", "=", request.id)
    .where("request_tests.test_id", "=", measurement.testId)
    .executeTakeFirst();
  if (!requested) return refused("test_not_found");
  if (requested.source !== measurement.source) {
    return refuse(
      trx,
      measurement,
      measurement.source === "manual" ? "not_manual_test" : "source_mismatch",
    );
  }
  if (measurement.source === "manual" && requested.released_at !== null) {
    return refuse(trx, measurement, "released");
  }
  const sampleId = parseSampleId(measurement.sampleId);
  const sample =
    sampleId === null
      ? undefined
      : await trx
          .selectFrom("samples")
          .select("id")
          .where("id", "=", sampleId)
          .where("request_id", "=", request.id)
          .where("lab_id", "=", lab.id)
          .executeTakeFirst();
  if (!sample) {
    if (measurement.auditActor.type === "user") {
      logRecordsProbe(measurement.auditActor.id, "sample", measurement.sampleId);
    }
    return refused("sample_not_found");
  }
  const value = parseDecimal(measurement.value);
  if (value === null) return refuse(trx, measurement, "value_invalid");
  const row = await trx
    .insertInto("measurements")
    .values({
      simulation_id: lab.simulation_id,
      lab_id: lab.id,
      request_id: request.id,
      test_id: measurement.testId,
      sample_id: sample.id,
      value,
      source: measurement.source,
      recorded_by: measurement.recordedBy,
      upload_id: measurement.uploadId ?? null,
    })
    .returning(["id", "recorded_at"])
    .executeTakeFirstOrThrow();
  const measurementId = parseMeasurementId(row.id);
  if (measurementId === null) throw new Error("the database returned a malformed measurement id");
  await recordAudit(trx, {
    ...measurementEvent(measurement),
    outcome: "success",
    metadata: {
      lab_request_id: request.id,
      test_id: measurement.testId,
      measurement_id: measurementId,
    },
  });
  return done({ measurementId, recordedAt: row.recorded_at.toISOString() });
}

/** A measurement a team enters by hand. */
export interface ManualMeasurementInput {
  labId: string;
  requestId: string;
  testId: string;
  sampleId: string;
  value: string;
}

/**
 * Records a measurement the team entered by hand (S14, D9), through the student's own place in
 * the lab of a running simulation, then {@link insertMeasurement}. The server takes the time.
 *
 * @throws AuthError 403 without the app role student.
 */
export function recordManualMeasurement(
  db: Kysely<DB>,
  actor: ResultsActor,
  input: ManualMeasurementInput,
): Promise<ResultsResult<StoredMeasurement>> {
  const measurement: NewMeasurement = {
    ...input,
    source: "manual",
    recordedBy: actor.id,
    auditActor: { type: "user", id: actor.id },
  };
  return withResultsLab(
    db,
    actor,
    input.labId,
    (trx, lab) => insertMeasurement(trx, { ...measurement, labId: lab.labId }),
    async (trx) => {
      await refuse(trx, measurement, "not_running");
    },
  );
}
