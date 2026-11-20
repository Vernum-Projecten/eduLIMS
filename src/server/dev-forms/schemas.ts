// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The forms of the development page `/dev/forms` (#61): a request editor (the tests of a
// request, each with its measurements, as S12 and S14 describe them) and a session form with one
// field of every kind. Fictional data, nothing saved. Shared by the page and the stub server
// functions, so both refuse the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { emailListSchema } from "@/lib/forms/email-list";

// NOTE: no requirement governs these bounds: our own design for a demonstration page.
export const DEMO_SAMPLE_NUMBER_MAX = 40;
export const DEMO_NAME_MAX = 80;
export const DEMO_TESTS_MAX = 10;
export const DEMO_MEASUREMENTS_MAX = 6;
export const DEMO_VALUE_MAX = 1000;
export const DEMO_NOTES_MAX = 500;
export const DEMO_GROUP_MAX = 30;
export const DEMO_OBSERVERS_MAX = 10;

/** A row's own id, so a moved row keeps its React key and its focus. */
const rowId = z.string().min(1).max(64);

const valueInvalid = () => m.dev_forms_value_invalid({ max: String(DEMO_VALUE_MAX) });

const value = z
  .number({ error: valueInvalid })
  .min(0, { error: valueInvalid })
  .max(DEMO_VALUE_MAX, { error: valueInvalid });

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

/** One measurement of a test: its name (a run) and its value. */
export const demoMeasurementSchema = z.object({
  id: rowId,
  label: z
    .string()
    .trim()
    .min(1, { error: () => m.dev_forms_run_label_required() })
    .max(DEMO_NAME_MAX, { error: tooLong(DEMO_NAME_MAX) }),
  value,
});

/** One requested test with its measurements. */
export const demoTestSchema = z.object({
  id: rowId,
  name: z
    .string()
    .trim()
    .min(1, { error: () => m.dev_forms_test_name_required() })
    .max(DEMO_NAME_MAX, { error: tooLong(DEMO_NAME_MAX) }),
  measurements: z
    .array(demoMeasurementSchema)
    .min(1, { error: () => m.dev_forms_runs_required() })
    .max(DEMO_MEASUREMENTS_MAX, {
      error: () => m.dev_forms_runs_too_many({ max: String(DEMO_MEASUREMENTS_MAX) }),
    }),
});

const sampleNumber = z
  .string()
  .trim()
  .min(1, { error: () => m.dev_forms_sample_number_required() })
  .max(DEMO_SAMPLE_NUMBER_MAX, { error: tooLong(DEMO_SAMPLE_NUMBER_MAX) });

/** The request editor: a sample number and its tests, each with its measurements. */
export const demoRequestSchema = z.object({
  sampleNumber,
  tests: z
    .array(demoTestSchema)
    .min(1, { error: () => m.dev_forms_tests_required() })
    .max(DEMO_TESTS_MAX, {
      error: () => m.dev_forms_tests_too_many({ max: String(DEMO_TESTS_MAX) }),
    }),
});
export type DemoRequestForm = z.input<typeof demoRequestSchema>;
export type DemoTest = DemoRequestForm["tests"][number];
export type DemoMeasurement = DemoTest["measurements"][number];

/** The input of the debounced sample number check. */
export const demoSampleNumberInput = z.strictObject({ sampleNumber });

export const DEMO_ANALYSERS = ["afinion", "epoch"] as const;
export const DEMO_SESSION_PARTS = ["morning", "afternoon", "day"] as const;
export const DEMO_MEASUREMENTS = ["hba1c", "crp", "absorbance"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The session form: one field of every registered kind. */
export const demoSessionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => m.dev_forms_session_name_required() })
    .max(DEMO_NAME_MAX, { error: tooLong(DEMO_NAME_MAX) }),
  notes: z.string().max(DEMO_NOTES_MAX, { error: tooLong(DEMO_NOTES_MAX) }),
  groupSize: z
    .number({ error: () => m.dev_forms_group_size_invalid({ max: String(DEMO_GROUP_MAX) }) })
    .int({ error: () => m.dev_forms_group_size_invalid({ max: String(DEMO_GROUP_MAX) }) })
    .min(1, { error: () => m.dev_forms_group_size_invalid({ max: String(DEMO_GROUP_MAX) }) })
    .max(DEMO_GROUP_MAX, {
      error: () => m.dev_forms_group_size_invalid({ max: String(DEMO_GROUP_MAX) }),
    }),
  analyser: z
    .enum([...DEMO_ANALYSERS, ""])
    .refine((value) => value !== "", { error: () => m.dev_forms_analyser_required() }),
  part: z
    .enum([...DEMO_SESSION_PARTS, ""])
    .refine((value) => value !== "", { error: () => m.dev_forms_part_required() }),
  measurements: z
    .array(z.enum(DEMO_MEASUREMENTS))
    .min(1, { error: () => m.dev_forms_measurements_required() }),
  day: z.string().regex(DAY, { error: () => m.dev_forms_day_required() }),
  reminder: z.boolean(),
  observers: emailListSchema(DEMO_OBSERVERS_MAX),
  simulateRefusal: z.boolean(),
});
export type DemoSessionForm = z.input<typeof demoSessionSchema>;
