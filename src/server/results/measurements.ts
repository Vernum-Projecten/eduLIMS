// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements of a requested test (S14). Every measurement is a new row and none is changed or
// removed, so a team that measures again keeps both. Entry by hand is one route; the Afinion 2
// (#158) and the Epoch 2 upload (#152) write through the same `insertMeasurement`.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { parseDecimal } from "../../lib/decimal.ts";
import { parseRequestId, parseSampleId } from "../../lib/lab-records.ts";
import {
  type MeasurementId,
  type MeasurementSource,
  parseMeasurementId,
} from "../../lib/results.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { logRecordsProbe } from "../lab-records/access.ts";
import { done, type ResultsActor, type ResultsResult, refused, withResultsLab } from "./access.ts";

/** One measurement to store, from any route. */
export interface NewMeasurement {
  simulationId: string;
  labId: string;
  requestId: string;
  testId: string;
  sampleId: string;
  /** The value as the route read it: parsed and bounded here, never trusted. */
  value: string;
  source: MeasurementSource;
  /** The student who entered it, or `null` for an analyser. */
  recordedBy: string | null;
}

/** A stored measurement: its id and the database clock at the insert. */
export interface StoredMeasurement {
  measurementId: MeasurementId;
  recordedAt: string;
}

/**
 * Stores one measurement of a requested test and its activity-log row (ids only, never the
 * value). A value that is no decimal within the bounds (more than 9 digits before the point, more
 * than 6 after, exponent form) is refused with `value_invalid` and stores nothing.
 *
 * The caller has already, in `trx`: matched the sample and the request to one lab, checked that
 * the lab's simulation runs, locked the request `FOR SHARE` (so a correction or a release
 * serialises with it), and refused a released requested test.
 */
export async function insertMeasurement(
  trx: Transaction<DB>,
  measurement: NewMeasurement,
): Promise<ResultsResult<StoredMeasurement>> {
  const value = parseDecimal(measurement.value);
  if (value === null) return refused("value_invalid");
  const row = await trx
    .insertInto("measurements")
    .values({
      simulation_id: measurement.simulationId,
      lab_id: measurement.labId,
      request_id: measurement.requestId,
      test_id: measurement.testId,
      sample_id: measurement.sampleId,
      value,
      source: measurement.source,
      recorded_by: measurement.recordedBy,
    })
    .returning(["id", "recorded_at"])
    .executeTakeFirstOrThrow();
  const measurementId = parseMeasurementId(row.id);
  if (measurementId === null) throw new Error("the database returned a malformed measurement id");
  await recordAudit(trx, {
    action: "lab_measurement_recorded",
    actor:
      measurement.recordedBy === null
        ? { type: "system" }
        : { type: "user", id: measurement.recordedBy },
    target: { type: "lab", id: measurement.labId },
    outcome: "success",
    metadata: {
      lab_request_id: measurement.requestId,
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
 * Locks a request of the lab `FOR SHARE` and reads its requested test, or returns the refusal: an
 * unknown or another lab's request (`request_not_found`, logged), a test the request does not
 * name (`test_not_found`), and a released requested test (`released`).
 */
async function openRequestedTest(
  trx: Transaction<DB>,
  actorId: string,
  labId: string,
  requestId: string,
  testId: string,
): Promise<ResultsResult<{ requestId: string; source: string }>> {
  const id = parseRequestId(requestId);
  const request =
    id === null
      ? undefined
      : await trx
          .selectFrom("requests")
          .select("id")
          .where("id", "=", id)
          .where("lab_id", "=", labId)
          .forShare()
          .executeTakeFirst();
  if (!request) {
    logRecordsProbe(actorId, "request", requestId);
    return refused("request_not_found");
  }
  const requested = await trx
    .selectFrom("request_tests")
    .innerJoin("catalogue_tests", "catalogue_tests.id", "request_tests.test_id")
    .select(["request_tests.released_at", "catalogue_tests.source"])
    .where("request_tests.request_id", "=", request.id)
    .where("request_tests.test_id", "=", testId)
    .executeTakeFirst();
  if (!requested) return refused("test_not_found");
  if (requested.released_at !== null) return refused("released");
  return done({ requestId: request.id, source: requested.source });
}

/**
 * Records a measurement the team entered by hand (S14, D9): only for a test whose source is entry
 * by hand (`not_manual_test`), on a sample of the same request (`sample_not_found`, logged), and
 * not after the release (`released`). The server takes the time.
 *
 * @throws AuthError 403 without the app role student.
 */
export function recordManualMeasurement(
  db: Kysely<DB>,
  actor: ResultsActor,
  input: ManualMeasurementInput,
): Promise<ResultsResult<StoredMeasurement>> {
  return withResultsLab(db, actor, input.labId, async (trx, lab) => {
    const opened = await openRequestedTest(trx, actor.id, lab.labId, input.requestId, input.testId);
    if (!opened.ok) return opened;
    if (opened.value.source !== "manual") return refused("not_manual_test");
    const sampleId = parseSampleId(input.sampleId);
    const sample =
      sampleId === null
        ? undefined
        : await trx
            .selectFrom("samples")
            .select("id")
            .where("id", "=", sampleId)
            .where("request_id", "=", opened.value.requestId)
            .where("lab_id", "=", lab.labId)
            .executeTakeFirst();
    if (!sample) {
      logRecordsProbe(actor.id, "sample", input.sampleId);
      return refused("sample_not_found");
    }
    return insertMeasurement(trx, {
      simulationId: lab.simulationId,
      labId: lab.labId,
      requestId: opened.value.requestId,
      testId: input.testId,
      sampleId: sample.id,
      value: input.value,
      source: "manual",
      recordedBy: actor.id,
    });
  });
}
