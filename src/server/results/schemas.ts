// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of a lab's measurements and results (S14, S15, #270), shared by the forms and the
// server functions, so both sides refuse the same input. A value stays decimal text: "5,2" becomes
// "5.2", and a value past the bounds or in exponent form is refused here, never parsed as a float.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { parseDecimal } from "@/lib/decimal";

/** A measured value typed in a field: required, within the bounds, returned in canonical form. */
const measuredValue = z
  .string()
  .trim()
  .min(1, { error: () => m.results_value_required() })
  .transform((value, ctx) => {
    const parsed = parseDecimal(value);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: m.results_value_invalid() });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * An id from the client in its canonical lower-case form, so an upper-case UUID reaches the same
 * row and is not refused as unknown (security review of #370, N3).
 */
const id = () => z.uuid().toLowerCase();

/** The measurements and results of one lab. */
export const labResultsInput = z.object({ labId: id() });

/** The form of a measurement entered by hand: the sample and the value, nothing filled in. */
export const measurementFormSchema = z.object({
  sampleId: z.string().min(1, { error: () => m.results_sample_required() }),
  value: measuredValue,
});
export type MeasurementForm = z.input<typeof measurementFormSchema>;

/** Recording a measurement by hand in the student's own lab (S14). */
export const recordMeasurementInput = z.object({
  labId: id(),
  requestId: id(),
  testId: id(),
  sampleId: id(),
  value: measuredValue,
});
export type RecordMeasurementInput = z.output<typeof recordMeasurementInput>;

/** Releasing one measurement as the result, with the tolerance the confirmation showed (S15). */
export const releaseResultInput = z.object({
  labId: id(),
  requestId: id(),
  testId: id(),
  measurementId: id(),
  toleranceId: id(),
});
export type ReleaseResultInput = z.output<typeof releaseResultInput>;
