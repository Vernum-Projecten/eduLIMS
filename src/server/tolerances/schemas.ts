// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of a team's tolerances (S13, #269), shared by the form and the server functions, so
// both sides refuse the same input. Numbers stay decimal text: the schema turns "5,2" into "5.2"
// and the database stores it as `numeric`, never as a float.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { compareDecimals, parseDecimal } from "@/lib/decimal";

/** A decimal typed in a field: required, within the bounds, returned in canonical form. */
function decimal(required: () => string) {
  return z
    .string()
    .trim()
    .min(1, { error: required })
    .transform((value, ctx) => {
      const parsed = parseDecimal(value);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: m.tolerances_number_invalid() });
        return z.NEVER;
      }
      return parsed;
    });
}

const bounds = z.object({
  lower: decimal(() => m.tolerances_lower_required()),
  upper: decimal(() => m.tolerances_upper_required()),
});

/** Refuses a lower limit above the upper limit; equal limits are allowed (S13). */
function checkOrder(tolerance: { lower: string; upper: string }, ctx: z.RefinementCtx): void {
  if (parseDecimal(tolerance.lower) === null || parseDecimal(tolerance.upper) === null) return;
  if (compareDecimals(tolerance.lower, tolerance.upper) > 0) {
    ctx.addIssue({ code: "custom", path: ["lower"], message: m.tolerances_order() });
  }
}

/** The tolerance form of one test (S13): the lower and the upper limit, nothing filled in. */
export const toleranceFormSchema = bounds.superRefine(checkOrder);
export type ToleranceForm = z.input<typeof toleranceFormSchema>;

/** Setting the tolerance of one test in the student's own lab. */
export const setToleranceInput = bounds
  .extend({ labId: z.uuid(), testId: z.uuid() })
  .superRefine(checkOrder);
export type SetToleranceInput = z.output<typeof setToleranceInput>;

/** The tolerances of one lab. */
export const labTolerancesInput = z.object({ labId: z.uuid() });
