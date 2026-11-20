// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The tolerance form and its server input share one schema (S13): both limits required, numbers
// only, the lower limit not above the upper limit, in `en` and `nl`.
import { afterEach, describe, expect, it } from "vitest";
import { overwriteGetLocale } from "@/i18n/runtime";
import { setToleranceInput, toleranceFormSchema } from "./schemas.ts";

const LAB = "01960000-0000-7000-8000-0000000000a1";
const TEST = "01960000-0000-7000-8000-0000000000b1";

function messages(input: unknown): string[] {
  const result = toleranceFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

afterEach(() => {
  overwriteGetLocale(() => "en");
});

describe("the tolerance form (S13)", () => {
  it("accepts two numbers and returns them as canonical decimals", () => {
    expect(toleranceFormSchema.parse({ lower: " 4,20 ", upper: "006.35" })).toEqual({
      lower: "4.20",
      upper: "6.35",
    });
  });

  it("accepts equal limits and negative numbers", () => {
    expect(toleranceFormSchema.safeParse({ lower: "5", upper: "5" }).success).toBe(true);
    expect(toleranceFormSchema.safeParse({ lower: "-2", upper: "-1.5" }).success).toBe(true);
  });

  it("refuses a lower limit above the upper limit, at the lower field", () => {
    const result = toleranceFormSchema.safeParse({ lower: "6.1", upper: "6" });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["lower"],
        message: "The lower limit cannot be above the upper limit.",
      }),
    ]);
  });

  it("refuses an empty limit with a message per field", () => {
    expect(messages({ lower: "", upper: " " })).toEqual([
      "Enter the lower limit.",
      "Enter the upper limit.",
    ]);
  });

  it("refuses a value that is no number, and one beyond the bounds", () => {
    const invalid = "Enter a number with at most 9 digits before and 6 after the decimal point.";
    expect(messages({ lower: "abc", upper: "6" })).toEqual([invalid]);
    expect(messages({ lower: "1e3", upper: "6" })).toEqual([invalid]);
    expect(messages({ lower: "1.1234567", upper: "6" })).toEqual([invalid]);
    expect(messages({ lower: "1", upper: "1000000000" })).toEqual([invalid]);
  });

  it("says it in Dutch in the nl locale", () => {
    overwriteGetLocale(() => "nl");
    expect(messages({ lower: "7", upper: "6" })).toEqual([
      "De ondergrens mag niet boven de bovengrens liggen.",
    ]);
  });
});

describe("the server input of a tolerance", () => {
  it("needs a lab id and a test id as uuids", () => {
    expect(setToleranceInput.safeParse({ lower: "1", upper: "2" }).success).toBe(false);
    expect(
      setToleranceInput.safeParse({ labId: "x", testId: TEST, lower: "1", upper: "2" }).success,
    ).toBe(false);
    expect(setToleranceInput.parse({ labId: LAB, testId: TEST, lower: "1,5", upper: "2" })).toEqual(
      { labId: LAB, testId: TEST, lower: "1.5", upper: "2" },
    );
  });

  it("refuses a crafted lower limit above the upper limit that bypasses the form", () => {
    expect(
      setToleranceInput.safeParse({ labId: LAB, testId: TEST, lower: "3", upper: "2" }).success,
    ).toBe(false);
  });
});
