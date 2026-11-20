// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR of a registered patient in FerroEHR (S11, Q-TRACE-1, #147). The subject is the patient's
// eduLIMS id, so two teams that register the same patient from the same form get two EHRs (S10).
// eduLIMS finds the EHR by its subject before it creates one, and reads it again after a 409, so
// a retry or two concurrent calls end with one EHR. A failure leaves the patient pending, logged
// with ids only; the next call tries again.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { PatientId } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { type EhrSubjectRef, ehrStatusFor, patientSubject } from "../openehr/ehr.ts";
import { failure, type OpenEhrError, type OpenEhrResult, success } from "../openehr/errors.ts";
import type { OpenEhrClient } from "../openehr/index.ts";
import { failureCause, logSecurityEvent } from "../security-log.ts";

/** The FerroEHR operations a patient's EHR needs. */
export type PatientEhrClient = Pick<OpenEhrClient, "getEhrBySubject" | "createEhr">;

/**
 * The EHR of a patient: `ready` with FerroEHR's EHR id, or `pending` with the failure that kept
 * eduLIMS from finding or creating it.
 */
export type PatientEhrState =
  | { state: "ready"; ehrId: string }
  | { state: "pending"; error: OpenEhrError };

/**
 * Returns the id of the EHR whose subject is `subject`, creating the EHR when none names it
 * (ITS-REST 1.1.0, EHR API, "Get EHR by subject id" and "Create EHR").
 */
export async function resolveSubjectEhr(
  client: PatientEhrClient,
  subject: EhrSubjectRef,
): Promise<OpenEhrResult<string>> {
  const found = await client.getEhrBySubject(subject);
  if (!found.ok) return found;
  if (found.value !== null) return success(found.value.ehr_id.value.toLowerCase());
  const created = await client.createEhr(ehrStatusFor(subject));
  if (!created.ok) return created;
  if (created.value.outcome === "created") {
    return success(created.value.ehr.ehr_id.value.toLowerCase());
  }
  // NOTE: ITS-REST 1.1.0, "Create EHR", 409: another call created the EHR of this subject first.
  const again = await client.getEhrBySubject(subject);
  if (!again.ok) return again;
  if (again.value === null) {
    return failure({
      kind: "invalid_response",
      target: "ferroehr",
      status: 404,
      problem: "unexpected_shape",
    });
  }
  return success(again.value.ehr_id.value.toLowerCase());
}

// TODO(#148): the release of a result calls ensurePatientEhr before it writes its composition.
/**
 * Returns the EHR of a patient, finding or creating it in FerroEHR while the patient has none
 * yet, and stores its id. A FerroEHR failure leaves the patient pending and logs
 * `ferroehr_ehr_pending` with the patient's id; it never throws.
 *
 * The caller has checked that the actor reaches the patient; this function checks nothing.
 *
 * @throws Error when the patient does not exist, or when it holds another EHR id than the one
 *   its subject resolves to.
 */
export async function ensurePatientEhr(
  db: Kysely<DB>,
  client: PatientEhrClient,
  patientId: PatientId,
): Promise<PatientEhrState> {
  const stored = await readEhrId(db, patientId);
  if (stored !== null) return { state: "ready", ehrId: stored };
  const resolved = await resolveSubjectEhr(client, patientSubject(patientId));
  if (!resolved.ok) {
    logEhrPending(patientId, resolved.error);
    return { state: "pending", error: resolved.error };
  }
  const ehrId = resolved.value;
  const updated = await db
    .updateTable("patients")
    .set({ ehr_id: ehrId })
    .where("id", "=", patientId)
    .where("ehr_id", "is", null)
    .returning("ehr_id")
    .executeTakeFirst();
  if (updated) return { state: "ready", ehrId };
  // NOTE: no openEHR spec governs this: our own design; a concurrent call stored the id first,
  // and it must be the same EHR, or the subject index is broken and eduLIMS stops.
  const current = await readEhrId(db, patientId);
  if (current !== ehrId) {
    throw new Error(`patient ${patientId} holds another EHR than its subject resolves to`);
  }
  return { state: "ready", ehrId };
}

/** Returns the stored EHR id of a patient, or `null` while it is pending. */
async function readEhrId(db: Kysely<DB>, patientId: PatientId): Promise<string | null> {
  const row = await db
    .selectFrom("patients")
    .select("ehr_id")
    .where("id", "=", patientId)
    .executeTakeFirst();
  if (!row) throw new Error(`patient ${patientId} does not exist`);
  return row.ehr_id;
}

/** Writes a pending EHR to the security stream at level `error`: ids and codes only. */
function logEhrPending(patientId: PatientId, error: OpenEhrError): void {
  logSecurityEvent("error", "ferroehr_ehr_pending", {
    outcome: "failure",
    target_type: "patient",
    target_id: patientId,
    kind: error.kind,
    status: "status" in error ? error.status : undefined,
    reason: reasonOf(error),
    cause: "cause" in error && error.cause !== undefined ? failureCause(error.cause) : undefined,
  });
}

function reasonOf(error: OpenEhrError): string | undefined {
  switch (error.kind) {
    case "refused":
      return error.code ?? undefined;
    case "auth_refused":
      return error.reason ?? undefined;
    case "invalid_response":
      return error.problem;
    case "unreachable":
    case "timeout":
      return error.target;
    default: {
      const unhandled: never = error;
      return String(unhandled);
    }
  }
}
