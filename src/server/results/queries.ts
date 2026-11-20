// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a lab's measurements and results (S14, S15, D11). A student reads only a lab they
// are a member of, through the lab predicate on the session user (S10, R-01); a teacher reads a
// lab of a simulation they teach, through its teacher rows (D10, D11). Both reads hold the team's
// own measurements and tolerances and nothing else: no correct value, no accuracy limit and no
// accuracy status (Q-SIM-1).
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { parseTestSourceKind, type TestSourceKind } from "../../lib/catalogue.ts";
import {
  type NotOfferedTest,
  type PatientId,
  parsePatientId,
  parseRequestId,
  parseRequestKind,
  parseSampleId,
  type RequestId,
  type RequestKind,
  type SampleId,
} from "../../lib/lab-records.ts";
import {
  type MeasurementId,
  type MeasurementSource,
  type PatientRecordState,
  parseMeasurementId,
  parseMeasurementSource,
  type RequestedTestState,
  requestedTestState,
} from "../../lib/results.ts";
import { parseLabId } from "../../lib/simulations.ts";
import type { Tolerance } from "../../lib/tolerance.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent, logRecordsProbe } from "../lab-records/access.ts";
import { notOfferedOf } from "../lab-records/not-offered.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "../simulations/access.ts";
import { findStudentLab } from "../simulations/student-access.ts";

/** One measurement of a requested test. */
export interface MeasurementRow {
  id: MeasurementId;
  sampleId: SampleId;
  sampleNumber: string;
  labNumber: string;
  /** A canonical decimal, as stored. */
  value: string;
  source: MeasurementSource;
  /** The database clock at the insert (ISO 8601). */
  recordedAt: string;
  /** Whether this is the released one, the one that counts (D11). */
  released: boolean;
}

/** The team's own tolerance with the id the release names. */
export interface ToleranceRef extends Tolerance {
  id: string;
}

/** One requested test with its measurements, its tolerance and its release. */
export interface RequestedTestRow {
  testId: string;
  name: string;
  unit: string | null;
  source: TestSourceKind;
  state: RequestedTestState;
  /** The lab's own tolerance in force now, or `null` when it has none (S13). */
  tolerance: ToleranceRef | null;
  /** The release with the tolerance that was in force at it (S15), or `null`. */
  release: {
    measurementId: MeasurementId;
    releasedAt: string;
    tolerance: Tolerance;
    /** Where the result stands in the patient's record (#148). */
    record: PatientRecordState;
  } | null;
  /** Every measurement, oldest first (S14). */
  measurements: MeasurementRow[];
}

/** A request of the lab, with what the results screen needs of it. */
export interface ResultsRequestRow {
  id: RequestId;
  kind: RequestKind;
  patientId: PatientId | null;
  /** The fictional patient's name as the team typed it (S11); `null` for a control request. */
  patientName: string | null;
  enteredAt: string;
  samples: { id: SampleId; sampleNumber: string; labNumber: string }[];
  /** The tests the form asks for that the lab does not offer, as the team typed them (#398). */
  notOffered: NotOfferedTest[];
  tests: RequestedTestRow[];
}

/** The measurements and results of one lab. */
export interface LabResults {
  labId: string;
  /** Whether the lab's simulation runs, so the team can measure and release. */
  running: boolean;
  requests: ResultsRequestRow[];
}

/** Narrows a stored value a CHECK holds to its type, failing loud on a broken row. */
function stored<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the database holds a bad ${what}`);
  return value;
}

/**
 * Returns where a release stands in the patient's record from its write row (#148): no row is a
 * control request, which writes nothing (S16).
 */
function recordState(state: string | null): PatientRecordState {
  if (state === null) return "none";
  if (state === "written" || state === "pending") return state;
  throw new Error("the database holds a bad result write state");
}

/**
 * Returns the measurements and results of `labId` in a stable order: requests newest first, tests
 * by name, measurements oldest first. Call it only after the caller's access check.
 */
async function labResults(db: Kysely<DB>, labId: string): Promise<LabResults> {
  const lab = await db
    .selectFrom("labs")
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .select(["labs.id", "simulations.state"])
    .where("labs.id", "=", labId)
    .executeTakeFirstOrThrow();
  const requests = await db
    .selectFrom("requests")
    .leftJoin("patients", "patients.id", "requests.patient_id")
    .select([
      "requests.id",
      "requests.kind",
      "requests.patient_id",
      "patients.name",
      "requests.entered_at",
    ])
    .where("requests.lab_id", "=", labId)
    .orderBy("requests.entered_at", "desc")
    .orderBy("requests.id", "desc")
    .execute();
  const ids = requests.map((request) => request.id);
  if (ids.length === 0) return { labId, running: lab.state === "running", requests: [] };
  const [tests, current, measurements, samples, notOffered] = await Promise.all([
    db
      .selectFrom("request_tests as rt")
      .innerJoin("catalogue_tests as t", "t.id", "rt.test_id")
      .leftJoin("lab_tolerances as lt", "lt.id", "rt.released_tolerance_id")
      .leftJoin("result_ehr_writes as w", "w.measurement_id", "rt.released_measurement_id")
      .select([
        "rt.request_id",
        "t.id",
        "t.name",
        "t.unit",
        "t.source",
        "rt.released_at",
        "rt.released_measurement_id",
        sql<string | null>`lt.lower_limit::text`.as("lower"),
        sql<string | null>`lt.upper_limit::text`.as("upper"),
        "w.state as record_state",
      ])
      .where("rt.request_id", "in", ids)
      .orderBy(sql`lower(t.name)`)
      .orderBy("t.id")
      .execute(),
    db
      .selectFrom("lab_tolerances")
      .distinctOn("test_id")
      .select([
        "id",
        "test_id",
        sql<string>`lower_limit::text`.as("lower"),
        sql<string>`upper_limit::text`.as("upper"),
      ])
      .where("lab_id", "=", labId)
      .orderBy("test_id")
      .orderBy("set_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    db
      .selectFrom("measurements as m")
      .innerJoin("samples as s", "s.id", "m.sample_id")
      .select([
        "m.id",
        "m.request_id",
        "m.test_id",
        "m.sample_id",
        "s.sample_number",
        "s.lab_number",
        sql<string>`m.value::text`.as("value"),
        "m.source",
        "m.recorded_at",
      ])
      .where("m.lab_id", "=", labId)
      .orderBy("m.recorded_at")
      .orderBy("m.id")
      .execute(),
    db
      .selectFrom("samples")
      .select(["id", "request_id", "sample_number", "lab_number"])
      .where("lab_id", "=", labId)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    notOfferedOf(db, ids),
  ]);
  const tolerances = new Map(current.map((row) => [row.test_id, row]));
  return {
    labId,
    running: lab.state === "running",
    requests: requests.map((request) => ({
      id: stored(parseRequestId(request.id), "request id"),
      kind: stored(parseRequestKind(request.kind), "request kind"),
      patientId:
        request.patient_id === null ? null : stored(parsePatientId(request.patient_id), "id"),
      patientName: request.name,
      enteredAt: request.entered_at.toISOString(),
      samples: samples
        .filter((sample) => sample.request_id === request.id)
        .map((sample) => ({
          id: stored(parseSampleId(sample.id), "sample id"),
          sampleNumber: sample.sample_number,
          labNumber: sample.lab_number,
        })),
      notOffered: notOffered.get(request.id) ?? [],
      tests: tests
        .filter((test) => test.request_id === request.id)
        .map((test): RequestedTestRow => {
          const own = measurements
            .filter((row) => row.request_id === request.id && row.test_id === test.id)
            .map((row) => ({
              id: stored(parseMeasurementId(row.id), "measurement id"),
              sampleId: stored(parseSampleId(row.sample_id), "sample id"),
              sampleNumber: row.sample_number,
              labNumber: row.lab_number,
              value: row.value,
              source: stored(parseMeasurementSource(row.source), "measurement source"),
              recordedAt: row.recorded_at.toISOString(),
              released: row.id === test.released_measurement_id,
            }));
          const tolerance = tolerances.get(test.id);
          return {
            testId: test.id,
            name: test.name,
            unit: test.unit,
            source: stored(parseTestSourceKind(test.source), "test source"),
            state: requestedTestState(own.length, test.released_at !== null),
            tolerance: tolerance
              ? { id: tolerance.id, lower: tolerance.lower, upper: tolerance.upper }
              : null,
            release:
              test.released_at === null
                ? null
                : {
                    measurementId: stored(
                      parseMeasurementId(test.released_measurement_id ?? ""),
                      "released measurement",
                    ),
                    releasedAt: test.released_at.toISOString(),
                    tolerance: {
                      lower: stored(test.lower, "release tolerance"),
                      upper: stored(test.upper, "release tolerance"),
                    },
                    record: recordState(test.record_state),
                  },
            measurements: own,
          };
        }),
    })),
  };
}

/**
 * Returns the measurements and results of `labId` for a student who is a member of it, or `null`
 * for a malformed id, an unknown lab and another lab alike, logged (S10, ASVS V16.3.2).
 *
 * @throws AuthError 403 without the app role student.
 */
export async function readStudentResults(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
): Promise<LabResults | null> {
  assertStudent(actor);
  const lab = await findStudentLab(db, actor.id, labId);
  if (lab === null) {
    logRecordsProbe(actor.id, "lab", labId);
    return null;
  }
  return labResults(db, lab.labId);
}

/**
 * Returns the measurements and results of a lab of a simulation the actor teaches: every
 * measurement of each requested test with the released one marked (D11), or `null` for a
 * malformed id, an unknown lab and another teacher's lab alike, logged.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function readTeacherResults(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
): Promise<LabResults | null> {
  assertTeacher(actor);
  const id = parseLabId(labId);
  const lab =
    id === null
      ? undefined
      : await db
          .selectFrom("labs")
          .innerJoin(
            "simulation_teachers",
            "simulation_teachers.simulation_id",
            "labs.simulation_id",
          )
          .select("labs.id")
          .where("labs.id", "=", id)
          .where("simulation_teachers.user_id", "=", actor.id)
          .executeTakeFirst();
  if (!lab) {
    logNotFound(actor.id, "lab", labId);
    return null;
  }
  return labResults(db, lab.id);
}
