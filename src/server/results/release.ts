// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Releasing one measurement of a requested test as its result (S15). The team picks the
// measurement and confirms; the server checks it against the team's own tolerance in force, takes
// the time of release from the database clock in the storing transaction, and keeps the
// tolerance with it. A released result is final, and only the lab whose sample it is releases it.
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import { parsePatientId, parseRequestId, type RequestId } from "../../lib/lab-records.ts";
import { type MeasurementId, parseMeasurementId } from "../../lib/results.ts";
import { checkMeasuredValue, type ToleranceCheck } from "../../lib/tolerance.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { logRecordsProbe } from "../lab-records/access.ts";
import { finalResultContributionUid } from "../openehr/contribution.ts";
import type { StudentLab } from "../simulations/student-access.ts";
import {
  done,
  logMeasurementProbe,
  type ResultsActionError,
  type ResultsActor,
  type ResultsResult,
  refused,
  withResultsLab,
} from "./access.ts";
import type { ReleasedResultRecord } from "./ehr-seam.ts";

/** A release as the team confirmed it. */
export interface ReleaseInput {
  labId: string;
  requestId: string;
  testId: string;
  measurementId: string;
  /** The tolerance the confirmation showed; a newer one in force refuses the release. */
  toleranceId: string;
}

/** A stored release. */
export interface Release {
  releasedAt: string;
  /** Where the value lay against the team's tolerance, as the warning showed it (S15). */
  check: ToleranceCheck;
  /** What goes to the patient's record (#148); `null` for a control request (S16). */
  record: ReleasedResultRecord | null;
}

/** The current tolerance of a lab and test: the newest row (S13). */
async function toleranceInForce(trx: Transaction<DB>, labId: string, testId: string) {
  return trx
    .selectFrom("lab_tolerances")
    .select([
      "id",
      sql<string>`lower_limit::text`.as("lower"),
      sql<string>`upper_limit::text`.as("upper"),
    ])
    .where("lab_id", "=", labId)
    .where("test_id", "=", testId)
    .orderBy("set_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** The audit event of a release, refused or done. */
function releaseEvent(actorId: string, lab: StudentLab, requestId: RequestId, testId: string) {
  return {
    action: "lab_result_released",
    actor: { type: "user", id: actorId },
    target: { type: "lab", id: lab.labId },
    metadata: { lab_request_id: requestId, test_id: testId },
  } as const;
}

/**
 * Releases one measurement of a requested test of the actor's lab (S15). Lock order after the
 * lab check: the lab row `FOR SHARE` (a tolerance change takes it `FOR NO KEY UPDATE`, so the
 * tolerance read stays the one in force), then the request `FOR UPDATE` (as a correction does).
 * Refused: `request_not_found` and `measurement_not_found` (logged), `test_not_found`, `released`
 * for a second release, `ehr_pending` for a patient whose EHR is not resolved yet, `no_tolerance`
 * without a tolerance, `tolerance_changed` when the one in force is not the one the team saw, and
 * `value_invalid` for a value the check cannot read. A patient's release commits a pending write
 * to FerroEHR with it (`result_ehr_writes`, #148).
 *
 * @throws AuthError 403 without the app role student.
 */
export function releaseResult(
  db: Kysely<DB>,
  actor: ResultsActor,
  input: ReleaseInput,
): Promise<ResultsResult<Release>> {
  return withResultsLab(
    db,
    actor,
    input.labId,
    async (trx, lab) => {
      await trx
        .selectFrom("labs")
        .select("id")
        .where("id", "=", lab.labId)
        .forShare()
        .executeTakeFirst();
      const requestId = parseRequestId(input.requestId);
      const request =
        requestId === null
          ? undefined
          : await trx
              .selectFrom("requests")
              .leftJoin("patients", "patients.id", "requests.patient_id")
              .select(["requests.id", "requests.kind", "requests.patient_id", "patients.ehr_id"])
              .where("requests.id", "=", requestId)
              .where("requests.lab_id", "=", lab.labId)
              .forUpdate("requests")
              .executeTakeFirst();
      if (!request || requestId === null) {
        logRecordsProbe(actor.id, "request", input.requestId);
        return refused<Release>("request_not_found");
      }
      const event = releaseEvent(actor.id, lab, requestId, input.testId);
      const refuse = async (reason: ResultsActionError) => {
        await recordAudit(trx, { ...event, outcome: "refused", reason });
        return refused<Release>(reason);
      };
      const requested = await trx
        .selectFrom("request_tests")
        .innerJoin("catalogue_tests", "catalogue_tests.id", "request_tests.test_id")
        .select(["request_tests.released_at", "catalogue_tests.name", "catalogue_tests.unit"])
        .where("request_tests.request_id", "=", requestId)
        .where("request_tests.test_id", "=", input.testId)
        .executeTakeFirst();
      if (!requested) return refused<Release>("test_not_found");
      if (requested.released_at !== null) return refuse("released");
      // NOTE: #148 (security review of #364); a patient's result is released only once its EHR
      // exists, so the write after the commit always has an EHR to go to.
      if (request.patient_id !== null && request.ehr_id === null) return refuse("ehr_pending");
      const measurementId = parseMeasurementId(input.measurementId);
      const measurement =
        measurementId === null
          ? undefined
          : await trx
              .selectFrom("measurements")
              .innerJoin("samples", "samples.id", "measurements.sample_id")
              .select([sql<string>`measurements.value::text`.as("value"), "samples.sample_number"])
              .where("measurements.id", "=", measurementId)
              .where("measurements.request_id", "=", requestId)
              .where("measurements.test_id", "=", input.testId)
              .where("measurements.lab_id", "=", lab.labId)
              .executeTakeFirst();
      if (!measurement || measurementId === null) {
        logMeasurementProbe(actor.id, input.measurementId);
        return refused<Release>("measurement_not_found");
      }
      // NOTE: S13, S15 (maintainer, 2026-11-19); a result is released only for a test that has a
      // tolerance, and the warning the team confirmed must be the one against the tolerance in force.
      const tolerance = await toleranceInForce(trx, lab.labId, input.testId);
      if (!tolerance) return refuse("no_tolerance");
      if (tolerance.id !== input.toleranceId) return refuse("tolerance_changed");
      const check = checkMeasuredValue(measurement.value, tolerance);
      if (check === null) return refuse("value_invalid");
      const stored = await trx
        .updateTable("request_tests")
        .set({
          released_measurement_id: measurementId,
          released_tolerance_id: tolerance.id,
          released_by: actor.id,
        })
        .where("request_id", "=", requestId)
        .where("test_id", "=", input.testId)
        .where("released_at", "is", null)
        .returning("released_at")
        .executeTakeFirst();
      if (!stored?.released_at) throw new Error("the release stored no time of release");
      if (request.patient_id !== null) {
        // NOTE: #148; the write to FerroEHR commits as pending with the release, so a release is
        // never without it; the write after the commit, or the retry schedule, completes it.
        await trx
          .insertInto("result_ehr_writes")
          .values({
            measurement_id: measurementId,
            contribution_uid: finalResultContributionUid(measurementId),
            next_attempt_at: sql`now() + interval '1 minute'`,
          })
          .execute();
      }
      await recordAudit(trx, {
        ...event,
        outcome: "success",
        metadata: {
          ...event.metadata,
          measurement_id: measurementId,
          tolerance_id: tolerance.id,
        },
      });
      const releasedAt = stored.released_at.toISOString();
      const patientId = request.patient_id === null ? null : parsePatientId(request.patient_id);
      return done({
        releasedAt,
        check,
        record:
          patientId === null
            ? null
            : resultRecord(patientId, requestId, input.testId, measurementId, {
                sampleNumber: measurement.sample_number,
                testName: requested.name,
                unit: requested.unit,
                value: measurement.value,
                releasedAt,
              }),
      });
    },
    async (trx) => {
      await recordAudit(trx, {
        action: "lab_result_released",
        actor: { type: "user", id: actor.id },
        target: { type: "lab", id: input.labId },
        outcome: "refused",
        reason: "not_running",
      });
    },
  );
}

/** Returns what goes to the patient's record for a release, and only that (Q-PRIV-1, Q-SIM-1). */
function resultRecord(
  patientId: NonNullable<ReturnType<typeof parsePatientId>>,
  requestId: RequestId,
  testId: string,
  measurementId: MeasurementId,
  details: Pick<
    ReleasedResultRecord,
    "sampleNumber" | "testName" | "unit" | "value" | "releasedAt"
  >,
): ReleasedResultRecord {
  return { patientId, requestId, testId, measurementId, ...details };
}
