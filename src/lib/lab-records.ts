// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The records a team keeps from the paper request form (S11, S12, S16): patients, requests and
// samples. The branded ids keep one kind of record out of another's place, and the bounds are
// the ones the forms and the database CHECKs share. No `@/` imports.

declare const patientIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const sampleIdBrand: unique symbol;

/** The id of a registered patient; never interchangeable with a request or a lab id. */
export type PatientId = string & { readonly [patientIdBrand]: true };

/** The id of a request; never interchangeable with a patient or a lab id. */
export type RequestId = string & { readonly [requestIdBrand]: true };

/** The id of a sample (one tube); its lab number is a separate value. */
export type SampleId = string & { readonly [sampleIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns `value` as a {@link PatientId} when it is a UUID in its text form, else `null`. */
export function parsePatientId(value: string): PatientId | null {
  return UUID.test(value) ? (value as PatientId) : null;
}

/** Returns `value` as a {@link RequestId} when it is a UUID in its text form, else `null`. */
export function parseRequestId(value: string): RequestId | null {
  return UUID.test(value) ? (value as RequestId) : null;
}

/** Returns `value` as a {@link SampleId} when it is a UUID in its text form, else `null`. */
export function parseSampleId(value: string): SampleId | null {
  return UUID.test(value) ? (value as SampleId) : null;
}

/** A request for a patient, or for a control sample, which has no patient (S16). */
export const REQUEST_KINDS = ["patient", "control"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Returns `value` when it names a {@link RequestKind}, else `undefined`. */
export function parseRequestKind(value: unknown): RequestKind | undefined {
  return REQUEST_KINDS.find((kind) => kind === value);
}

/** The sex of a patient as a request form gives it (S11). */
export const PATIENT_SEXES = ["female", "male", "other", "unknown"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

/** Returns `value` when it names a {@link PatientSex}, else `undefined`. */
export function parsePatientSex(value: unknown): PatientSex | undefined {
  return PATIENT_SEXES.find((sex) => sex === value);
}

// NOTE: no requirement governs these bounds: our own design (#268), held by the database CHECKs.
/** The most characters a patient's name takes. */
export const PATIENT_NAME_MAX = 100;
/** The most characters the patient ID on the form takes. */
export const PATIENT_IDENTIFIER_MAX = 40;
/** The most characters the requester takes. */
export const REQUESTER_MAX = 100;
/** The most characters the remarks take. */
export const REMARKS_MAX = 1000;
/** The most characters a sample number takes, as for a correct value. */
export const RECORD_SAMPLE_NUMBER_MAX = 40;
/** The most characters a sample's material takes, as for a catalogue test. */
export const SAMPLE_MATERIAL_MAX = 40;
/** The most tests one request names. */
export const REQUEST_TESTS_MAX = 20;
/** The most samples one request records. */
export const REQUEST_SAMPLES_MAX = 10;
// NOTE: no requirement governs these bounds: our own design, accepted on #405 (2026-11-20); the
// CHECKs of migration 0029 hold the two text bounds.
/** The most characters the name of a test not offered takes, as for a catalogue test (#398). */
export const NOT_OFFERED_NAME_MAX = 80;
/** The most characters the remark on a test not offered takes, as for the requester (#398). */
export const NOT_OFFERED_REMARK_MAX = 100;
/** The most tests not offered one request lists, as many as the tests it names (#398). */
export const NOT_OFFERED_MAX = REQUEST_TESTS_MAX;

/**
 * A test the request form asks for that the lab does not offer (S12, #398): the name as written
 * on the form and an optional remark, never matched against the catalogue or anything else.
 */
export interface NotOfferedTest {
  name: string;
  remark: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns whether `value` is a calendar date written `YYYY-MM-DD`. Only a date that is no date is
 * refused (S11: eduLIMS corrects nothing), so a birth date in the future is the team's to see.
 */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year = "", month = "", day = ""] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y);
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
