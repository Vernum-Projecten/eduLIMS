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
import { failureCause, logFailure, logSecurityEvent } from "../security-log.ts";

declare const ehrIdBrand: unique symbol;

/**
 * The id of a patient's EHR in FerroEHR. Only the `ready` state of {@link ensurePatientEhr}
 * returns one, so a composition writer that takes an `EhrId` writes only to a resolved EHR.
 */
export type EhrId = string & { readonly [ehrIdBrand]: true };

/** Brands an EHR id that FerroEHR's answer schema (`z.uuid()`) or the `uuid` column checked. */
function asEhrId(value: string): EhrId {
  // NOTE: no openEHR spec governs this: our own design; both sources are checked UUIDs.
  return value.toLowerCase() as EhrId;
}

/** The FerroEHR operations a patient's EHR needs. */
export type PatientEhrClient = Pick<OpenEhrClient, "getEhrBySubject" | "createEhr">;

/**
 * The EHR of a patient: `ready` with FerroEHR's EHR id, or `pending` with the failure that kept
 * eduLIMS from finding or creating it.
 */
export type PatientEhrState =
  | { state: "ready"; ehrId: EhrId }
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

/** How long {@link ensurePatientEhr} may talk to FerroEHR in all; unbounded when left out. */
export interface PatientEhrOptions {
  /** The total budget in milliseconds across the token, the lookup and the create. */
  budgetMs?: number;
}

/**
 * Returns the EHR of a patient, finding or creating it in FerroEHR while the patient has none
 * yet, and stores its id. A FerroEHR failure, or a call past `budgetMs`, leaves the patient
 * pending and logs `ferroehr_ehr_pending` with the patient's id.
 *
 * The caller has checked that the actor reaches the patient; this function checks nothing.
 *
 * @throws Error when the patient does not exist, or when it holds another EHR id than the one
 *   its subject resolves to.
 */
// TODO(#148): the release of a result calls ensurePatientEhr and refuses on `pending`.
export async function ensurePatientEhr(
  db: Kysely<DB>,
  client: PatientEhrClient,
  patientId: PatientId,
  options: PatientEhrOptions = {},
): Promise<PatientEhrState> {
  const stored = await readEhrId(db, patientId);
  if (stored !== null) return { state: "ready", ehrId: asEhrId(stored) };
  const resolving = resolveSubjectEhr(client, patientSubject(patientId));
  const resolved =
    options.budgetMs === undefined ? await resolving : await within(resolving, options.budgetMs);
  if (!resolved.ok) {
    logEhrPending(patientId, resolved.error);
    return { state: "pending", error: resolved.error };
  }
  const ehrId = asEhrId(resolved.value);
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
  if (current === null || asEhrId(current) !== ehrId) {
    throw new Error(`patient ${patientId} holds another EHR than its subject resolves to`);
  }
  return { state: "ready", ehrId };
}

// NOTE: no openEHR spec governs this: our own design (#364); a registration waits at most 5 s
// for FerroEHR across the token, the lookup and the create, then answers with a pending EHR.
export const REGISTRATION_EHR_BUDGET_MS = 5_000;

/**
 * Returns the EHR state a registration reports, after its transaction committed: `ready`, or
 * `pending` when FerroEHR failed, ran past {@link REGISTRATION_EHR_BUDGET_MS}, or
 * {@link ensurePatientEhr} threw, which it logs as `ferroehr_ehr_failed` with ids only.
 */
export async function ehrAfterRegistration(
  db: Kysely<DB>,
  client: PatientEhrClient,
  patientId: PatientId,
  options: PatientEhrOptions = { budgetMs: REGISTRATION_EHR_BUDGET_MS },
): Promise<PatientEhrState["state"]> {
  try {
    return (await ensurePatientEhr(db, client, patientId, options)).state;
  } catch (error) {
    // NOTE: #364; the patient is committed, so an error would invite a duplicate; the release
    // calls ensurePatientEhr again and stops on a mismatch.
    logFailure("ferroehr_ehr_failed", error, { target_type: "patient", target_id: patientId });
    return "pending";
  }
}

/**
 * Returns `resolving`, or a `timeout` failure once `budgetMs` has passed. A call past the budget
 * runs on under its own request timeouts; an EHR it creates is found by its subject next time.
 */
async function within(
  resolving: Promise<OpenEhrResult<string>>,
  budgetMs: number,
): Promise<OpenEhrResult<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<OpenEhrResult<string>>((resolve) => {
    timer = setTimeout(() => {
      const cause = new DOMException("the EHR budget ran out", "TimeoutError");
      resolve(failure({ kind: "timeout", target: "ferroehr", cause }));
    }, budgetMs);
  });
  try {
    return await Promise.race([resolving, expired]);
  } finally {
    clearTimeout(timer);
  }
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
