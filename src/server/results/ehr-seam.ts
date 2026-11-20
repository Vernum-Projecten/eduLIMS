// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The seam to FerroEHR for a released result (S15, #148). What crosses it names the patient's
// record and the released measurement by their eduLIMS ids and carries the value as the team
// released it: no correct value, no tolerance, no accuracy status and nothing about a student or a
// teacher (Q-SIM-1, Q-PRIV-1). The result of a control request has no patient and never crosses
// it (S16). `writeReleasedResult` (`ehr-write.ts`) writes it after the release commits.
import "@tanstack/react-start/server-only";
import type { PatientId, RequestId } from "../../lib/lab-records.ts";
import type { MeasurementId } from "../../lib/results.ts";

/** What the release hands on for the patient's record for one released result. */
export interface ReleasedResultRecord {
  /** The eduLIMS patient whose EHR holds the result (#147, #364). */
  patientId: PatientId;
  requestId: RequestId;
  testId: string;
  /** The released measurement; the write is idempotent on it, so a retry adds nothing. */
  measurementId: MeasurementId;
  /** The sample number of the form, for the specimen cluster (Q-TRACE-1). */
  sampleNumber: string;
  testName: string;
  unit: string | null;
  /** The value as a canonical decimal, as stored. */
  value: string;
  /** The time of release, from the database clock (ISO 8601). */
  releasedAt: string;
}
