// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The measurement form and the inputs of results share one value rule (S14, S15; the security
// review of #352): a decimal within the bounds, in canonical form, never exponent form; ids are
// UUIDs, and no input names a time (Q-SIM-2).
import { describe, expect, it } from "vitest";
import {
  labResultsInput,
  measurementFormSchema,
  recordMeasurementInput,
  releaseResultInput,
} from "./schemas.ts";

const ID = "01960000-0000-7000-8000-0000000000a1";

function messages(input: unknown): string[] {
  const result = measurementFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("the measurement form (S14)", () => {
  it("returns the value as a canonical decimal, a comma included", () => {
    expect(measurementFormSchema.parse({ sampleId: ID, value: " 05,20 " })).toEqual({
      sampleId: ID,
      value: "5.20",
    });
  });

  it("refuses a missing sample and a missing value, each with its own message", () => {
    expect(messages({ sampleId: "", value: "" })).toEqual([
      "Choose the sample you measured.",
      "Enter the measured value.",
    ]);
  });

  it.each(["1e5", "1.5E+01", "1234567890", "1.1234567", "five", "NaN"])(
    "refuses %j as no number within the bounds",
    (value) => {
      expect(messages({ sampleId: ID, value })).toEqual([
        "Enter a number with at most 9 digits before and 6 after the decimal separator.",
      ]);
    },
  );
});

describe("the inputs of the server functions (E1, Q-SIM-2)", () => {
  it("take UUIDs only", () => {
    expect(labResultsInput.safeParse({ labId: "nope" }).success).toBe(false);
    expect(
      recordMeasurementInput.safeParse({
        labId: ID,
        requestId: ID,
        testId: ID,
        sampleId: "nope",
        value: "1",
      }).success,
    ).toBe(false);
    expect(
      releaseResultInput.safeParse({
        labId: ID,
        requestId: ID,
        testId: ID,
        measurementId: ID,
        toleranceId: "nope",
      }).success,
    ).toBe(false);
  });

  it("drop a time a caller smuggles into a measurement or a release", () => {
    const measured = recordMeasurementInput.parse({
      labId: ID,
      requestId: ID,
      testId: ID,
      sampleId: ID,
      value: "1",
      recordedAt: "2000-01-01T00:00:00Z",
    });
    expect(measured).not.toHaveProperty("recordedAt");
    const released = releaseResultInput.parse({
      labId: ID,
      requestId: ID,
      testId: ID,
      measurementId: ID,
      toleranceId: ID,
      releasedAt: "2000-01-01T00:00:00Z",
    });
    expect(released).not.toHaveProperty("releasedAt");
  });
});
