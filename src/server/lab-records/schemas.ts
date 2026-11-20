// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of patients, requests and samples (S11, S12, S16), shared by the forms and the
// server functions, so both sides refuse the same input. They refuse only what a real LIMS would
// refuse: a missing required field, a date that is no date, a text past its bound. Nothing is
// checked against the simulation, and nothing is filled in or corrected (W7).
import { z } from "zod";
import { m } from "@/i18n/messages";
import { CONTROL_OR_FORMAT } from "@/lib/catalogue";
import {
  isIsoDate,
  PATIENT_IDENTIFIER_MAX,
  PATIENT_NAME_MAX,
  PATIENT_SEXES,
  RECORD_SAMPLE_NUMBER_MAX,
  REMARKS_MAX,
  REQUEST_SAMPLES_MAX,
  REQUEST_TESTS_MAX,
  REQUESTER_MAX,
  SAMPLE_MATERIAL_MAX,
} from "@/lib/lab-records";

const id = z.uuid();

/** A required one-line text of the form: trimmed, at most `max` characters, no control signs. */
function formLine(max: number, required: () => string) {
  return z
    .string()
    .trim()
    .min(1, { error: required })
    .max(max, { error: () => m.form_too_long({ max: String(max) }) })
    .refine((value) => !CONTROL_OR_FORMAT.test(value), {
      error: () => m.records_text_invalid(),
    });
}

/** An optional one-line text: empty becomes `null`. */
function optionalLine(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: () => m.form_too_long({ max: String(max) }) })
    .refine((value) => !CONTROL_OR_FORMAT.test(value), {
      error: () => m.records_text_invalid(),
    })
    .transform((value) => (value === "" ? null : value));
}

/**
 * A control or format character other than a tab or a line break: remarks take several lines,
 * never a NUL, an escape or a hidden direction mark (security review of #351, S1).
 */
const REMARKS_FORBIDDEN = /(?![\t\n\r])[\p{Cc}\p{Cf}]/u;

/** The remarks: free text over several lines, empty becomes `null`. */
const remarks = z
  .string()
  .trim()
  .max(REMARKS_MAX, { error: () => m.form_too_long({ max: String(REMARKS_MAX) }) })
  .refine((value) => !REMARKS_FORBIDDEN.test(value), { error: () => m.records_text_invalid() })
  .transform((value) => (value === "" ? null : value));

/** The details of a patient as the form gives them (S11). */
export const patientDetailsSchema = z.object({
  name: formLine(PATIENT_NAME_MAX, () => m.records_patient_name_required()),
  dateOfBirth: z
    .string()
    .trim()
    .min(1, { error: () => m.records_patient_birth_required() })
    .refine(isIsoDate, { error: () => m.records_patient_birth_invalid() }),
  sex: z.enum(PATIENT_SEXES, { error: () => m.records_patient_sex_required() }),
  identifier: formLine(PATIENT_IDENTIFIER_MAX, () => m.records_patient_identifier_required()),
});
export type PatientDetailsForm = z.input<typeof patientDetailsSchema>;

/** Registering a patient in a lab. */
export const registerPatientInput = patientDetailsSchema.extend({ labId: id });

/** Correcting a patient of a lab. */
export const correctPatientInput = patientDetailsSchema.extend({ labId: id, patientId: id });

/** One sample as the form gives it: the sample number and the material (S12). */
export const sampleSchema = z.object({
  sampleNumber: formLine(RECORD_SAMPLE_NUMBER_MAX, () => m.records_sample_number_required()),
  material: formLine(SAMPLE_MATERIAL_MAX, () => m.records_sample_material_required()),
});

/** The tests a request names: at least one, each once (S12). */
const testIds = z
  .array(z.uuid())
  .min(1, { error: () => m.records_tests_required() })
  .max(REQUEST_TESTS_MAX, {
    error: () => m.records_tests_too_many({ max: String(REQUEST_TESTS_MAX) }),
  })
  .refine((ids) => new Set(ids).size === ids.length, { error: () => m.records_tests_repeated() });

const requestFields = {
  phoneThrough: z.boolean(),
  remarks,
  testIds,
};

/** The samples of a new request: at least one. */
const newSamples = z
  .array(sampleSchema)
  .min(1, { error: () => m.records_samples_required() })
  .max(REQUEST_SAMPLES_MAX, {
    error: () => m.records_samples_too_many({ max: String(REQUEST_SAMPLES_MAX) }),
  });

/** Recording a request: for a patient of the lab, or for a control sample (S12, S16). */
export const recordRequestInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("patient"),
    labId: id,
    patientId: z.uuid({ error: () => m.records_patient_required() }),
    requester: formLine(REQUESTER_MAX, () => m.records_requester_required()),
    ...requestFields,
    samples: newSamples,
  }),
  z.object({
    kind: z.literal("control"),
    labId: id,
    requester: optionalLine(REQUESTER_MAX),
    ...requestFields,
    samples: newSamples,
  }),
]);
export type RecordRequestForm = z.input<typeof recordRequestInput>;

/** Correcting a request: its fields, and its samples (an id to change one, none to add one). */
export const correctRequestInput = z.object({
  labId: id,
  requestId: id,
  requester: optionalLine(REQUESTER_MAX),
  ...requestFields,
  samples: z
    .array(sampleSchema.extend({ sampleId: z.uuid().optional() }))
    .min(1, { error: () => m.records_samples_required() })
    .max(REQUEST_SAMPLES_MAX, {
      error: () => m.records_samples_too_many({ max: String(REQUEST_SAMPLES_MAX) }),
    })
    .refine(
      (samples) => {
        const ids = samples.flatMap((sample) => (sample.sampleId ? [sample.sampleId] : []));
        return new Set(ids).size === ids.length;
      },
      { error: () => m.records_samples_repeated() },
    ),
});
export type CorrectRequestForm = z.input<typeof correctRequestInput>;

/** The records of one lab, as its student reads them. */
export const labRecordsInput = z.object({ labId: id });

/** The correction log of one simulation, as its teacher reads it. */
export const correctionLogInput = z.object({ simulationId: id });
