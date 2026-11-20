// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The seam to FerroEHR for a registered patient (S11; #147 builds the EHR). A patient's EHR
// carries the fictional details the team typed from the form and nothing else: no lab, no
// simulation and nothing about a student or a teacher (Q-PRIV-1). The link from the EHR to its
// lab stays in the eduLIMS database, through the patient's id.
import "@tanstack/react-start/server-only";
import type { PatientId, PatientSex } from "../../lib/lab-records.ts";

/** What #147 sends to FerroEHR for one patient: the fictional details of the form, by its id. */
export interface PatientEhrSubject {
  /** The eduLIMS patient id, the subject's id in the EHR's namespace. */
  patientId: PatientId;
  name: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
  sex: PatientSex;
  /** The patient ID printed on the form. */
  identifier: string;
}

/**
 * Creates the EHR of a registered patient. #147 implements it after the registering transaction
 * commits; it must be idempotent on `patientId`, so a retry does not create a second EHR.
 */
export type CreatePatientEhr = (subject: PatientEhrSubject) => Promise<void>;

/** Returns the subject of a patient's EHR from what the team registered, and only that. */
export function patientEhrSubject(
  patientId: PatientId,
  details: { name: string; dateOfBirth: string; sex: PatientSex; identifier: string },
): PatientEhrSubject {
  return {
    patientId,
    name: details.name,
    dateOfBirth: details.dateOfBirth,
    sex: details.sex,
    identifier: details.identifier,
  };
}
