// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What eduLIMS may tell FerroEHR about a registered patient (S11): the fictional details the
// team typed from the form and the patient's id, and nothing else: no lab, no simulation and
// nothing about a student or a teacher (Q-PRIV-1). The link from the EHR to its lab stays in the
// eduLIMS database, through the patient's id; `patient-ehr.ts` creates the EHR (#147).
import "@tanstack/react-start/server-only";
import type { PatientId, PatientSex } from "../../lib/lab-records.ts";

/** The fictional details of the form for one patient, by its id. */
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
