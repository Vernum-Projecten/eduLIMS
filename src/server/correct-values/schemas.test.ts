// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  CORRECT_VALUES_BATCH_MAX,
  type GridProblem,
  SAMPLE_NUMBER_MAX,
} from "../../lib/correct-values.ts";
import {
  correctValueIdInput,
  correctValueRowSchema,
  gridPasteSchema,
  gridProblemMessage,
  limitsFormSchema,
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

describe("the paste of a grid (D10, #401)", () => {
  const schema = gridPasteSchema([{ id: TEST, name: "Glucose" }]);

  it("accepts a grid that reads", () => {
    expect(schema.safeParse({ text: "Sample\tGlucose\nS-1\t5,2" }).success).toBe(true);
  });

  it("asks for at least one value", () => {
    expect(messages(schema.safeParse({ text: "Sample\tGlucose\nS-1\t" }))).toEqual([
      "Paste at least one correct value under a test.",
    ]);
  });

  it("counts the parts that do not read, which the preview marks", () => {
    expect(messages(schema.safeParse({ text: "Sample\tAlbumin\tGlucose\nS-1\t1\tx" }))).toEqual([
      "2 parts of the paste need a fix. They are marked in the preview.",
    ]);
    expect(messages(schema.safeParse({ text: "Sample\tAlbumin\nS-1\t1" }))).toEqual([
      "1 part of the paste needs a fix. It is marked in the preview.",
    ]);
  });

  it("refuses more values than one entry takes", () => {
    const rows = Array.from({ length: CORRECT_VALUES_BATCH_MAX + 1 }, (_, n) => `S-${n};1`);
    const text = ["Sample;Glucose", ...rows].join("\n");
    expect(messages(schema.safeParse({ text }))).toEqual([
      `Save at most ${CORRECT_VALUES_BATCH_MAX} values at a time.`,
    ]);
  });

  it("words every problem", () => {
    const problems: GridProblem[] = [
      { kind: "header", column: 1, reason: "unknown_test", text: "Albumin" },
      { kind: "header", column: 1, reason: "empty_test", text: "" },
      { kind: "header", column: 1, reason: "repeated_test", text: "" },
      { kind: "row", row: 1, reason: "sample_number" },
      { kind: "row", row: 1, reason: "repeated_sample" },
      { kind: "row", row: 1, reason: "columns" },
      { kind: "cell", row: 1, column: 1, reason: "number" },
    ];
    const words = problems.map(gridProblemMessage);
    expect(words[0]).toContain("Albumin");
    expect(new Set(words).size).toBe(problems.length);
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
