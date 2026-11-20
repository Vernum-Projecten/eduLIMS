// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Registering and correcting a patient from the paper request form (S11). The team types the
// details as they stand on the form; eduLIMS stores them as typed and fills in or corrects
// nothing. A correction is allowed until the first result of one of the patient's requests is
// released, and leaves a correction row for the teacher (maintainer, 2026-11-19 on #268).
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import { APP_TIME_ZONE } from "../../lib/i18n/format.ts";
import { type PatientId, type PatientSex, parsePatientId } from "../../lib/lab-records.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import type { StudentLab } from "../simulations/student-access.ts";
import {
  done,
  logRecordsProbe,
  type RecordsActor,
  type RecordsResult,
  refused,
  withWorkingLab,
} from "./access.ts";
import { type CorrectionChange, plainChanges, recordCorrection } from "./corrections.ts";
import { type PatientEhrSubject, patientEhrSubject } from "./ehr-seam.ts";

/** The details of a patient as the form gives them (S11). */
export interface PatientDetails {
  name: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
  sex: PatientSex;
  /** The patient ID printed on the form. */
  identifier: string;
}

/** A registered patient: its id, and what #147 needs to create its EHR. */
export interface RegisteredPatient {
  patientId: PatientId;
  ehr: PatientEhrSubject;
}

/**
 * Returns whether `dateOfBirth` (`YYYY-MM-DD`) lies after today in {@link APP_TIME_ZONE}, by the
 * clock of the database server in the caller's transaction.
 */
export async function bornAfterToday(trx: Kysely<DB>, dateOfBirth: string): Promise<boolean> {
  // NOTE: maintainer, 2026-11-20 on #268; a real LIMS refuses a birth date in the future,
  // which is a check of the date, never of the scenario (W7).
  const result = await sql<{ future: boolean }>`
    select ${dateOfBirth}::date > (now() at time zone ${APP_TIME_ZONE})::date as future`.execute(
    trx,
  );
  return result.rows[0]?.future === true;
}

/**
 * Registers a patient in the actor's lab (S11) and logs `lab_patient_registered` with ids. A
 * date of birth after today is refused (`birth_in_future`).
 */
export function registerPatient(
  db: Kysely<DB>,
  actor: RecordsActor,
  input: { labId: string } & PatientDetails,
): Promise<RecordsResult<RegisteredPatient>> {
  return withWorkingLab(db, actor, input.labId, async (trx, lab) => {
    if (await bornAfterToday(trx, input.dateOfBirth)) return refused("birth_in_future");
    const row = await trx
      .insertInto("patients")
      .values({
        simulation_id: lab.simulationId,
        lab_id: lab.labId,
        name: input.name,
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        identifier: input.identifier,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const patientId = parsePatientId(row.id);
    if (patientId === null) throw new Error("the database returned a malformed patient id");
    await recordAudit(trx, {
      action: "lab_patient_registered",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: lab.labId },
      outcome: "success",
      metadata: { patient_id: patientId },
    });
    return done({ patientId, ehr: patientEhrSubject(patientId, input) });
  });
}

/**
 * Returns whether a result of one of the patient's requests is released. The patient's requests
 * are read `FOR SHARE`, so a release, which locks its request `FOR UPDATE`, waits for the
 * correction to commit (or the correction waits for the release).
 */
async function patientHasRelease(trx: Transaction<DB>, patientId: string): Promise<boolean> {
  const requests = await trx
    .selectFrom("requests")
    .select("id")
    .where("patient_id", "=", patientId)
    .orderBy("id")
    .forShare()
    .execute();
  if (requests.length === 0) return false;
  const released = await trx
    .selectFrom("request_tests")
    .select("request_id")
    .where(
      "request_id",
      "in",
      requests.map((request) => request.id),
    )
    .where("released_at", "is not", null)
    .executeTakeFirst();
  return released !== undefined;
}

/** Locks a patient of `lab` `FOR UPDATE` and returns its details, or `null` for another lab's. */
async function lockPatient(trx: Transaction<DB>, lab: StudentLab, patientId: string) {
  const id = parsePatientId(patientId);
  if (id === null) return null;
  const row = await trx
    .selectFrom("patients")
    .select([
      "id",
      "name",
      "sex",
      "identifier",
      sql<string>`to_char(date_of_birth, 'YYYY-MM-DD')`.as("date_of_birth"),
    ])
    .where("id", "=", id)
    .where("lab_id", "=", lab.labId)
    .forUpdate()
    .executeTakeFirst();
  return row ? { ...row, id } : null;
}

/** What a correction did: the number of fields it changed (zero writes nothing). */
export interface CorrectionOutcome {
  changed: number;
}

/**
 * Corrects a patient of the actor's lab (S11): refused once a result of one of its requests is
 * released (`released`), and a date of birth after today (`birth_in_future`). The fields that differ are written with a correction row and logged as
 * `lab_patient_corrected` with ids; a correction that changes nothing writes nothing.
 */
export function correctPatient(
  db: Kysely<DB>,
  actor: RecordsActor,
  input: { labId: string; patientId: string } & PatientDetails,
): Promise<RecordsResult<CorrectionOutcome>> {
  return withWorkingLab(db, actor, input.labId, async (trx, lab) => {
    const patient = await lockPatient(trx, lab, input.patientId);
    if (patient === null) {
      logRecordsProbe(actor.id, "patient", input.patientId);
      return refused("patient_not_found");
    }
    const event = {
      action: "lab_patient_corrected",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: lab.labId },
      metadata: { patient_id: patient.id },
    } as const;
    if (await patientHasRelease(trx, patient.id)) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "released" });
      return refused("released");
    }
    if (await bornAfterToday(trx, input.dateOfBirth)) return refused("birth_in_future");
    const changes: CorrectionChange[] = plainChanges(
      ["name", "date_of_birth", "sex", "identifier"],
      patient,
      {
        name: input.name,
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        identifier: input.identifier,
      },
    );
    if (changes.length === 0) return done({ changed: 0 });
    await trx
      .updateTable("patients")
      .set({
        name: input.name,
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        identifier: input.identifier,
        updated_by: actor.id,
        updated_at: sql`now()`,
      })
      .where("id", "=", patient.id)
      .execute();
    await recordCorrection(trx, lab, { kind: "patient", patientId: patient.id }, actor.id, changes);
    await recordAudit(trx, { ...event, outcome: "success" });
    return done({ changed: changes.length });
  });
}
