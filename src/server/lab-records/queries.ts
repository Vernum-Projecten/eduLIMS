// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a team's records (S10, S11, S12, S16). A student reads only the records of a lab
// they are a member of: the membership is the first query, and every record query joins the
// student's own `lab_members` row again, so no read selects broadly and filters after. Nothing
// here selects a correct value, a limit or another lab's work (Q-SIM-1).
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import {
  type PatientId,
  type PatientSex,
  parsePatientId,
  parsePatientSex,
  parseRequestId,
  parseRequestKind,
  parseSampleId,
  type RequestId,
  type RequestKind,
  type SampleId,
} from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { findStudentLab } from "../simulations/student-access.ts";
import { assertStudent, logRecordsProbe, type RecordsActor } from "./access.ts";

/** A patient as the team registered it. */
export interface PatientRow {
  id: PatientId;
  name: string;
  dateOfBirth: string;
  sex: PatientSex;
  identifier: string;
  /** Whether a result of one of its requests is released, so it can no longer be corrected. */
  locked: boolean;
}

/** A sample of a request, with the lab number eduLIMS gave it. */
export interface SampleRow {
  id: SampleId;
  sampleNumber: string;
  material: string;
  labNumber: string;
}

/** A request as the team recorded it. */
export interface RequestRow {
  id: RequestId;
  kind: RequestKind;
  patientId: PatientId | null;
  requester: string | null;
  phoneThrough: boolean;
  remarks: string | null;
  /** The time of entry, from the database clock (ISO 8601). */
  enteredAt: string;
  locked: boolean;
  tests: { id: string; name: string; unit: string | null }[];
  samples: SampleRow[];
}

/** The records of one lab: its patients and its requests. */
export interface LabRecords {
  labId: string;
  /** Whether the lab's simulation runs, so the team can write (D10, #267). */
  running: boolean;
  patients: PatientRow[];
  requests: RequestRow[];
}

/** Narrows a stored value that a CHECK holds to its type, failing loud on a broken row. */
function stored<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the database holds a bad ${what}`);
  return value;
}

/** Whether a result of one of the patient's requests is released (S11). */
const patientReleased = sql<boolean>`exists (select 1 from requests r
  join request_tests t on t.request_id = r.id
  where r.patient_id = patients.id and t.released_at is not null)`;

/** Whether a result of the request is released (S12). */
const requestReleased = sql<boolean>`exists (select 1 from request_tests t
  where t.request_id = requests.id and t.released_at is not null)`;

/**
 * Returns the patients and requests of lab `labId` for a student who is a member of it, in a
 * stable order (patients by registration, requests newest first), or `null` for a malformed id,
 * an unknown lab and another lab alike, logged.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function readLabRecords(
  db: Kysely<DB>,
  actor: RecordsActor,
  labId: string,
): Promise<LabRecords | null> {
  assertStudent(actor);
  const lab = await findStudentLab(db, actor.id, labId);
  if (lab === null) {
    logRecordsProbe(actor.id, "lab", labId);
    return null;
  }
  const simulation = await db
    .selectFrom("simulations")
    .select("state")
    .where("id", "=", lab.simulationId)
    .executeTakeFirstOrThrow();
  const patients = await db
    .selectFrom("patients")
    .innerJoin("lab_members", (join) =>
      join
        .onRef("lab_members.lab_id", "=", "patients.lab_id")
        .on("lab_members.user_id", "=", actor.id),
    )
    .select([
      "patients.id",
      "patients.name",
      "patients.sex",
      "patients.identifier",
      sql<string>`to_char(patients.date_of_birth, 'YYYY-MM-DD')`.as("date_of_birth"),
      patientReleased.as("locked"),
    ])
    .where("patients.lab_id", "=", lab.labId)
    .orderBy("patients.created_at")
    .orderBy("patients.id")
    .execute();
  const requests = await db
    .selectFrom("requests")
    .innerJoin("lab_members", (join) =>
      join
        .onRef("lab_members.lab_id", "=", "requests.lab_id")
        .on("lab_members.user_id", "=", actor.id),
    )
    .select([
      "requests.id",
      "requests.kind",
      "requests.patient_id",
      "requests.requester",
      "requests.phone_through",
      "requests.remarks",
      "requests.entered_at",
      requestReleased.as("locked"),
    ])
    .where("requests.lab_id", "=", lab.labId)
    .orderBy("requests.entered_at", "desc")
    .orderBy("requests.id", "desc")
    .execute();
  const ids = requests.map((request) => request.id);
  const tests =
    ids.length === 0
      ? []
      : await db
          .selectFrom("request_tests")
          .innerJoin("catalogue_tests", "catalogue_tests.id", "request_tests.test_id")
          .select([
            "request_tests.request_id",
            "catalogue_tests.id",
            "catalogue_tests.name",
            "catalogue_tests.unit",
          ])
          .where("request_tests.request_id", "in", ids)
          .orderBy("catalogue_tests.name")
          .orderBy("catalogue_tests.id")
          .execute();
  const samples =
    ids.length === 0
      ? []
      : await db
          .selectFrom("samples")
          .select(["id", "request_id", "sample_number", "material", "lab_number"])
          .where("request_id", "in", ids)
          .where("lab_id", "=", lab.labId)
          .orderBy("created_at")
          .orderBy("id")
          .execute();
  return {
    labId: lab.labId,
    running: simulation.state === "running",
    patients: patients.map((row) => ({
      id: stored(parsePatientId(row.id), "patient id"),
      name: row.name,
      dateOfBirth: row.date_of_birth,
      sex: stored(parsePatientSex(row.sex), "sex"),
      identifier: row.identifier,
      locked: row.locked,
    })),
    requests: requests.map((row) => ({
      id: stored(parseRequestId(row.id), "request id"),
      kind: stored(parseRequestKind(row.kind), "request kind"),
      patientId: row.patient_id === null ? null : stored(parsePatientId(row.patient_id), "id"),
      requester: row.requester,
      phoneThrough: row.phone_through,
      remarks: row.remarks,
      enteredAt: row.entered_at.toISOString(),
      locked: row.locked,
      tests: tests
        .filter((test) => test.request_id === row.id)
        .map((test) => ({ id: test.id, name: test.name, unit: test.unit })),
      samples: samples
        .filter((sample) => sample.request_id === row.id)
        .map((sample) => ({
          id: stored(parseSampleId(sample.id), "sample id"),
          sampleNumber: sample.sample_number,
          material: sample.material,
          labNumber: sample.lab_number,
        })),
    })),
  };
}

/** A catalogue test a team can request: what the form shows, nothing about a simulation. */
export interface RequestableTest {
  id: string;
  name: string;
  unit: string | null;
  material: string;
}

/**
 * Returns the active tests of the catalogue by name, for the request form (D9, S12). Every lab
 * sees the same list: which tests a simulation has correct values for is never shown (Q-SIM-1).
 *
 * @throws AuthError 403 without the app role student.
 */
export async function listRequestableTests(
  db: Kysely<DB>,
  actor: RecordsActor,
): Promise<RequestableTest[]> {
  assertStudent(actor);
  return db
    .selectFrom("catalogue_tests")
    .select(["id", "name", "unit", "material"])
    .where("retired_at", "is", null)
    .orderBy("name")
    .orderBy("id")
    .execute();
}
