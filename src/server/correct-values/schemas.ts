// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of correct values and accuracy limits (D10, D13, #267), shared by the forms and the
// server functions, so both sides refuse the same input. Numbers stay decimal text: the schema
// turns "5,2" into "5.2" and the database stores it as `numeric`, never as a float.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { CONTROL_OR_FORMAT } from "@/lib/catalogue";
import {
  CORRECT_VALUES_BATCH_MAX,
  LIMIT_KINDS,
  type PasteProblem,
  type PasteTest,
  parsePastedRows,
  SAMPLE_NUMBER_MAX,
} from "@/lib/correct-values";
import { compareDecimals, isNegativeDecimal, parseDecimal } from "@/lib/decimal";

const id = z.uuid();

const sampleNumber = z
  .string()
  .trim()
  .min(1, { error: () => m.correct_values_sample_required() })
  .max(SAMPLE_NUMBER_MAX, {
    error: () => m.form_too_long({ max: String(SAMPLE_NUMBER_MAX) }),
  })
  .refine((value) => !CONTROL_OR_FORMAT.test(value), {
    error: () => m.correct_values_sample_invalid(),
  });

/** A decimal typed in a field: required, within the bounds, returned in canonical form. */
function decimal(required: () => string) {
  return z
    .string()
    .trim()
    .min(1, { error: required })
    .transform((value, ctx) => {
      const parsed = parseDecimal(value);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: m.correct_values_number_invalid() });
        return z.NEVER;
      }
      return parsed;
    });
}

/** One correct value: the sample number, the catalogue test and the value (D10). */
export const correctValueRowSchema = z.object({
  sampleNumber,
  testId: z.uuid({ error: () => m.correct_values_test_required() }),
  value: decimal(() => m.correct_values_value_required()),
});
export type CorrectValueRowForm = z.input<typeof correctValueRowSchema>;
export type CorrectValueRow = z.output<typeof correctValueRowSchema>;

/** Returns the key two rows share when they name one value: the sample number and the test. */
function rowKey(row: { sampleNumber: string; testId: string }): string {
  return `${row.sampleNumber.trim().toLowerCase()}\u0000${row.testId}`;
}

/** Setting correct values: new keys are added, known keys get the new value. */
export const setCorrectValuesInput = z.object({
  simulationId: id,
  rows: z
    .array(correctValueRowSchema)
    .min(1)
    .max(CORRECT_VALUES_BATCH_MAX, {
      error: () => m.correct_values_too_many({ max: String(CORRECT_VALUES_BATCH_MAX) }),
    })
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const key = rowKey(row);
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "sampleNumber"],
            message: m.correct_values_repeated(),
          });
        }
        seen.add(key);
      });
    }),
});

/** One correct value of a simulation, named by its id. */
export const correctValueIdInput = z.object({ simulationId: id, correctValueId: id });

/** The correct values of one simulation. */
export const correctValuesPageInput = z.object({ simulationId: id });

/** Returns the translated message of one pasted line the parser could not read. */
export function pasteProblemMessage(problem: PasteProblem): string {
  const line = String(problem.line);
  switch (problem.reason) {
    case "columns":
      return m.correct_values_paste_columns({ line });
    case "unknown_test":
      return m.correct_values_paste_unknown_test({ line, test: problem.text });
    case "sample_number":
      return m.correct_values_paste_sample_number({ line, max: String(SAMPLE_NUMBER_MAX) });
    case "number":
      return m.correct_values_paste_number({ line });
    case "repeated":
      return m.correct_values_paste_repeated({ line });
    default: {
      const unknown: never = problem.reason;
      return unknown;
    }
  }
}

/**
 * The paste form (D10): lines of a sample number, a test name and a value, separated by a tab or
 * a semicolon. Every line that does not read is reported at the field, naming its line, so the
 * teacher fixes it there; the lines that read become the rows of {@link setCorrectValuesInput}.
 */
export function pasteFormSchema(tests: readonly PasteTest[]) {
  return z.object({
    text: z.string().superRefine((text, ctx) => {
      const { rows, problems } = parsePastedRows(text, tests);
      if (rows.length === 0 && problems.length === 0) {
        ctx.addIssue({ code: "custom", message: m.correct_values_paste_required() });
      }
      if (rows.length > CORRECT_VALUES_BATCH_MAX) {
        ctx.addIssue({
          code: "custom",
          message: m.correct_values_too_many({ max: String(CORRECT_VALUES_BATCH_MAX) }),
        });
      }
      for (const problem of problems) {
        ctx.addIssue({ code: "custom", message: pasteProblemMessage(problem) });
      }
    }),
  });
}
export type PasteForm = z.input<ReturnType<typeof pasteFormSchema>>;

const limitsBase = z.object({
  kind: z.enum(LIMIT_KINDS, { error: () => m.correct_values_limit_kind_required() }),
  yellow: decimal(() => m.correct_values_limit_required()),
  red: decimal(() => m.correct_values_limit_required()),
});

/** Refuses a negative limit and a red limit closer than the yellow one (D13). */
function checkLimits(limits: { yellow: string; red: string }, ctx: z.RefinementCtx): void {
  if (parseDecimal(limits.yellow) === null || parseDecimal(limits.red) === null) return;
  if (isNegativeDecimal(limits.yellow)) {
    ctx.addIssue({ code: "custom", path: ["yellow"], message: m.correct_values_limit_negative() });
  }
  if (isNegativeDecimal(limits.red)) {
    ctx.addIssue({ code: "custom", path: ["red"], message: m.correct_values_limit_negative() });
  } else if (compareDecimals(limits.red, limits.yellow) < 0) {
    ctx.addIssue({ code: "custom", path: ["red"], message: m.correct_values_limit_order() });
  }
}

/** The limits form of one test (D13): the kind, the yellow limit and the red limit. */
export const limitsFormSchema = limitsBase.superRefine(checkLimits);
export type LimitsForm = z.input<typeof limitsFormSchema>;

/** Setting the limits of one test in a simulation. */
export const setLimitsInput = limitsBase
  .extend({ simulationId: id, testId: id })
  .superRefine(checkLimits);
