// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CORRECT_VALUES_BATCH_MAX, SAMPLE_NUMBER_MAX } from "../../lib/correct-values.ts";
import {
  correctValueIdInput,
  correctValueRowSchema,
  limitsFormSchema,
  pasteFormSchema,
  pasteProblemMessage,
  setCorrectValuesInput,
  setLimitsInput,
} from "./schemas.ts";

const ID = "01960000-0000-7000-8000-000000000001";
const TEST = "01960000-0000-7000-8000-000000000002";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("one correct value (D10)", () => {
  it("turns a comma into a point and keeps the digits as text", () => {
    expect(
      correctValueRowSchema.parse({ sampleNumber: " S-001 ", testId: TEST, value: "5,20" }),
    ).toEqual({ sampleNumber: "S-001", testId: TEST, value: "5.20" });
  });

  it("names each missing field at the field", () => {
    const result = correctValueRowSchema.safeParse({ sampleNumber: " ", testId: "", value: "" });
    expect(messages(result)).toEqual([
      "Enter the sample number.",
      "Choose a test.",
      "Enter the correct value.",
    ]);
  });

  it("refuses a value that is no decimal, a long sample number and a control character", () => {
    expect(
      messages(correctValueRowSchema.safeParse({ sampleNumber: "S", testId: TEST, value: "1e3" })),
    ).toEqual([
      "Enter a number with at most 9 digits before and 6 after the decimal point, for example 6.5.",
    ]);
    expect(
      correctValueRowSchema.safeParse({
        sampleNumber: "S".repeat(SAMPLE_NUMBER_MAX + 1),
        testId: TEST,
        value: "1",
      }).success,
    ).toBe(false);
    expect(
      correctValueRowSchema.safeParse({ sampleNumber: "S\u202e1", testId: TEST, value: "1" })
        .success,
    ).toBe(false);
  });
});

describe("an entry of correct values (D10)", () => {
  it("refuses one sample number and test twice, regardless of case", () => {
    const result = setCorrectValuesInput.safeParse({
      simulationId: ID,
      rows: [
        { sampleNumber: "S-1", testId: TEST, value: "1" },
        { sampleNumber: "s-1", testId: TEST, value: "2" },
      ],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["rows", 1, "sampleNumber"] }),
    ]);
  });

  it("refuses an empty entry and one over the batch limit", () => {
    expect(setCorrectValuesInput.safeParse({ simulationId: ID, rows: [] }).success).toBe(false);
    const rows = Array.from({ length: CORRECT_VALUES_BATCH_MAX + 1 }, (_, n) => ({
      sampleNumber: `S-${n}`,
      testId: TEST,
      value: "1",
    }));
    expect(setCorrectValuesInput.safeParse({ simulationId: ID, rows }).success).toBe(false);
  });

  it("refuses a malformed id before any query runs", () => {
    expect(
      correctValueIdInput.safeParse({ simulationId: ID, correctValueId: "1 or 1=1" }).success,
    ).toBe(false);
  });
});

describe("the paste form (D10)", () => {
  const schema = pasteFormSchema([{ id: TEST, name: "Glucose" }]);

  it("accepts lines that read", () => {
    expect(schema.safeParse({ text: "S-1\tGlucose\t5,2" }).success).toBe(true);
  });

  it("asks for at least one row", () => {
    expect(messages(schema.safeParse({ text: "\n" }))).toEqual(["Paste at least one row."]);
  });

  it("names every line that does not read", () => {
    expect(
      messages(schema.safeParse({ text: "S-1\tAlbumin\t1\nS-2\tGlucose\tx\nS-3;Glucose" })),
    ).toEqual([
      "Line 1: the catalogue has no active test named “Albumin”.",
      "Line 2: the value is not a number, for example 6.5.",
      "Line 3: enter three columns, the sample number, the test and the value.",
    ]);
  });

  it("refuses more rows than one entry takes", () => {
    const text = Array.from(
      { length: CORRECT_VALUES_BATCH_MAX + 1 },
      (_, n) => `S-${n};Glucose;1`,
    ).join("\n");
    expect(messages(schema.safeParse({ text }))).toEqual([
      `Save at most ${CORRECT_VALUES_BATCH_MAX} values at a time.`,
    ]);
  });

  it("words every problem", () => {
    for (const reason of [
      "columns",
      "unknown_test",
      "sample_number",
      "number",
      "repeated",
    ] as const) {
      expect(pasteProblemMessage({ line: 4, reason, text: "X" })).toContain("Line 4");
    }
  });
});

describe("the accuracy limits (D13)", () => {
  it("accepts equal limits and a comma", () => {
    expect(limitsFormSchema.parse({ kind: "percent", yellow: "5,0", red: "5" })).toEqual({
      kind: "percent",
      yellow: "5.0",
      red: "5",
    });
  });

  it("refuses a red limit closer than the yellow one, compared as decimals", () => {
    const result = limitsFormSchema.safeParse({ kind: "absolute", yellow: "0.30", red: "0.29" });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["red"],
        message: "The red limit cannot be smaller than the yellow limit.",
      }),
    ]);
  });

  it("refuses a negative limit at its field", () => {
    const result = limitsFormSchema.safeParse({ kind: "absolute", yellow: "-1", red: "-0.5" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["yellow"], ["red"]]);
  });

  it("refuses an unknown kind and a missing limit", () => {
    expect(limitsFormSchema.safeParse({ kind: "relative", yellow: "1", red: "2" }).success).toBe(
      false,
    );
    expect(messages(limitsFormSchema.safeParse({ kind: "percent", yellow: "", red: "2" }))).toEqual(
      ["Enter the limit."],
    );
  });

  it("holds the same rules on the server's input", () => {
    expect(
      setLimitsInput.safeParse({
        simulationId: ID,
        testId: TEST,
        kind: "percent",
        yellow: "2",
        red: "1",
      }).success,
    ).toBe(false);
    expect(
      setLimitsInput.safeParse({
        simulationId: ID,
        testId: TEST,
        kind: "percent",
        yellow: "1",
        red: "2",
      }).success,
    ).toBe(true);
  });
});
