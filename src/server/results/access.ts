// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The access rule of a team's measurements and results (S10, S14, S15, R-01): the app role
// student, then the student's own place in the lab of a running simulation, read and locked in
// the first statement of the writing transaction (`findWorkingStudentLab`). Another lab, an
// unknown id and a malformed id all answer `not_found`, and the probe goes to the security stream
// with ids only.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { parseLabId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent, logRecordsProbe, type RecordsActor } from "../lab-records/access.ts";
import { logSecurityEvent } from "../security-log.ts";
import {
  findStudentLab,
  findWorkingStudentLab,
  type StudentLab,
} from "../simulations/student-access.ts";

/** Why a measurement or a release was refused; the screen maps each code to a message. */
export const RESULTS_ACTION_ERRORS = [
  "not_found",
  "not_running",
  "request_not_found",
  "test_not_found",
  "sample_not_found",
  "measurement_not_found",
  "not_manual_test",
  "source_mismatch",
  "value_invalid",
  "released",
  "no_tolerance",
  "tolerance_changed",
] as const;
export type ResultsActionError = (typeof RESULTS_ACTION_ERRORS)[number];

/** The outcome of an action: done with a value, or refused with a code. */
export type ResultsResult<T> = { ok: true; value: T } | { ok: false; error: ResultsActionError };

/** Returns a done result. */
export function done<T>(value: T): ResultsResult<T> {
  return { ok: true, value };
}

/** Returns a refusal. */
export function refused<T>(error: ResultsActionError): ResultsResult<T> {
  return { ok: false, error };
}

/** Who acts: the session user, never an id from the request. */
export type ResultsActor = RecordsActor;

/**
 * Writes a measurement the student does not reach (or that does not exist) to the security
 * stream as `authz_fail` (ASVS V16.3.2): the actor's id and the id asked for.
 */
export function logMeasurementProbe(actorId: string, id: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: "user",
    actor_id: actorId,
    target_type: "measurement",
    target_id: id,
    reason: "not_own_measurement",
    status: 404,
  });
}

/**
 * Runs `action` in one transaction after the lab check: the app role student (403), then the
 * actor's place in the lab of a running simulation, as the first statement. A member of a lab
 * whose simulation does not run gets `not_running`, after `onNotRunning` writes its activity-log
 * row in the same transaction; anyone else `not_found`, logged.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function withResultsLab<T>(
  db: Kysely<DB>,
  actor: ResultsActor,
  labId: string,
  action: (trx: Transaction<DB>, lab: StudentLab) => Promise<ResultsResult<T>>,
  onNotRunning: (trx: Transaction<DB>) => Promise<void>,
): Promise<ResultsResult<T>> {
  assertStudent(actor);
  if (parseLabId(labId) === null) {
    logRecordsProbe(actor.id, "lab", labId);
    return refused("not_found");
  }
  return db.transaction().execute(async (trx) => {
    const lab = await findWorkingStudentLab(trx, actor.id, labId);
    if (lab !== null) return action(trx, lab);
    if ((await findStudentLab(trx, actor.id, labId)) !== null) {
      await onNotRunning(trx);
      return refused<T>("not_running");
    }
    logRecordsProbe(actor.id, "lab", labId);
    return refused<T>("not_found");
  });
}
