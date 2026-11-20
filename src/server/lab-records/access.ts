// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The access rule of a team's records (S10, S11, S12, R-01): the app role student, then the
// student's own row in `lab_members`, read in the first statement of the transaction that writes
// (`findWorkingStudentLab`, which locks the simulation `FOR SHARE`, so a finish cannot overtake the
// write). Another lab, an unknown id and a malformed id all answer `not_found`, and the probe goes
// to the security stream with ids only.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import type { Role } from "../../lib/roles.ts";
import { parseLabId } from "../../lib/simulations.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { logSecurityEvent } from "../security-log.ts";
import {
  findStudentLab,
  findWorkingStudentLab,
  type StudentLab,
} from "../simulations/student-access.ts";

/** Why a records action was refused; the screens map each code to a translated message. */
export const RECORDS_ACTION_ERRORS = [
  "not_found",
  "not_running",
  "patient_not_found",
  "request_not_found",
  "sample_not_found",
  "test_not_found",
  "test_retired",
  "released",
  "requester_required",
] as const;
export type RecordsActionError = (typeof RECORDS_ACTION_ERRORS)[number];

/** The outcome of a records action: done with a value, or refused with a code. */
export type RecordsResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: RecordsActionError };

/** Returns a done result. */
export function done<T>(value: T): RecordsResult<T> {
  return { ok: true, value };
}

/** Returns a refusal. */
export function refused<T>(error: RecordsActionError): RecordsResult<T> {
  return { ok: false, error };
}

/** Who acts: the session user, never an id from the request. */
export interface RecordsActor {
  id: string;
  roles: readonly Role[];
}

/** What a refused probe asked for. */
export type RecordsProbe = "lab" | "patient" | "request" | "sample";

/**
 * Writes a lab, patient, request or sample the student does not reach (or that does not exist)
 * to the security stream as `authz_fail` (ASVS V16.3.2): the actor's id and the id asked for.
 */
export function logRecordsProbe(actorId: string, type: RecordsProbe, id: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: "user",
    actor_id: actorId,
    target_type: type,
    target_id: id,
    reason: `not_own_${type}`,
    status: 404,
  });
}

/**
 * Refuses a caller without the app role student (ADR 0012). The middleware checks first; this
 * keeps each action safe on its own.
 *
 * @throws AuthError 403 without the app role student.
 */
export function assertStudent(actor: Pick<RecordsActor, "roles">): void {
  if (!hasRole(actor, "student")) throw new AuthError(403);
}

/**
 * Runs `action` in one transaction after the lab check: the app role student (403), then the
 * actor's membership of the lab in a running simulation, as the first statement. A lab of
 * which the actor is a member, in a simulation that is not running, is `not_running`; anything
 * else is `not_found`, logged.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function withWorkingLab<T>(
  db: Kysely<DB>,
  actor: RecordsActor,
  labId: string,
  action: (trx: Transaction<DB>, lab: StudentLab) => Promise<RecordsResult<T>>,
): Promise<RecordsResult<T>> {
  assertStudent(actor);
  if (parseLabId(labId) === null) {
    logRecordsProbe(actor.id, "lab", labId);
    return refused("not_found");
  }
  return db.transaction().execute(async (trx) => {
    const lab = await findWorkingStudentLab(trx, actor.id, labId);
    if (lab !== null) return action(trx, lab);
    if ((await findStudentLab(trx, actor.id, labId)) !== null) return refused<T>("not_running");
    logRecordsProbe(actor.id, "lab", labId);
    return refused<T>("not_found");
  });
}
