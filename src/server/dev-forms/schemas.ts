// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The forms of the development page `/dev/forms` (#61): a rubric editor (criteria with levels
// and points, as D1 and D4 describe a rubric) and a session form with one field of every kind.
// Fictional data, nothing saved. Shared by the page and the stub server functions, so both
// refuse the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { emailListSchema } from "@/lib/forms/email-list";

// NOTE: no requirement governs these bounds: our own design for a demonstration page.
export const DEMO_TITLE_MAX = 120;
export const DEMO_NAME_MAX = 80;
export const DEMO_CRITERIA_MAX = 10;
export const DEMO_LEVELS_MAX = 6;
export const DEMO_POINTS_MAX = 100;
export const DEMO_NOTES_MAX = 500;
export const DEMO_GROUP_MAX = 30;
export const DEMO_OBSERVERS_MAX = 10;

/** A row's own id, so a moved row keeps its React key and its focus. */
const rowId = z.string().min(1).max(64);

const points = z
  .number({ error: () => m.dev_forms_points_invalid({ max: String(DEMO_POINTS_MAX) }) })
  .int({ error: () => m.dev_forms_points_invalid({ max: String(DEMO_POINTS_MAX) }) })
  .min(0, { error: () => m.dev_forms_points_invalid({ max: String(DEMO_POINTS_MAX) }) })
  .max(DEMO_POINTS_MAX, {
    error: () => m.dev_forms_points_invalid({ max: String(DEMO_POINTS_MAX) }),
  });

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

export const demoLevelSchema = z.object({
  id: rowId,
  label: z
    .string()
    .trim()
    .min(1, { error: () => m.dev_forms_level_label_required() })
    .max(DEMO_NAME_MAX, { error: tooLong(DEMO_NAME_MAX) }),
  points,
});

export const demoCriterionSchema = z.object({
  id: rowId,
  name: z
    .string()
    .trim()
    .min(1, { error: () => m.dev_forms_criterion_name_required() })
    .max(DEMO_NAME_MAX, { error: tooLong(DEMO_NAME_MAX) }),
  levels: z
    .array(demoLevelSchema)
    .min(1, { error: () => m.dev_forms_levels_required() })
    .max(DEMO_LEVELS_MAX, {
      error: () => m.dev_forms_levels_too_many({ max: String(DEMO_LEVELS_MAX) }),
    }),
});

const rubricTitle = z
  .string()
  .trim()
  .min(1, { error: () => m.dev_forms_title_required() })
  .max(DEMO_TITLE_MAX, { error: tooLong(DEMO_TITLE_MAX) });

/** The rubric editor: a title and its criteria, each with its levels and their points. */
export const demoRubricSchema = z.object({
  title: rubricTitle,
  criteria: z
    .array(demoCriterionSchema)
    .min(1, { error: () => m.dev_forms_criteria_required() })
    .max(DEMO_CRITERIA_MAX, {
      error: () => m.dev_forms_criteria_too_many({ max: String(DEMO_CRITERIA_MAX) }),
    }),
});
export type DemoRubricForm = z.input<typeof demoRubricSchema>;
export type DemoCriterion = DemoRubricForm["criteria"][number];
export type DemoLevel = DemoCriterion["levels"][number];

/** The input of the debounced title check. */
export const demoTitleInput = z.strictObject({ title: rubricTitle });

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
