// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RESULTS_ACTION_ERRORS } from "@/server/results/access";
import {
  measurementSourceLabel,
  releaseVerdict,
  requestedTestStateLabel,
  resultsErrorMessage,
  toleranceWarning,
} from "./results-labels";

const LIMITS = { lower: "4", upper: "6", unit: "mmol/L" };

describe("the words of results (S14, S15, ADR 0011)", () => {
  it("gives every refusal its own message, and a failure without a code a general one", () => {
    const messages = RESULTS_ACTION_ERRORS.map((code) => resultsErrorMessage(code));
    expect(new Set(messages).size).toBe(RESULTS_ACTION_ERRORS.length);
    expect(resultsErrorMessage(null)).toBe("The action failed. Try again.");
    expect(resultsErrorMessage("no_tolerance")).toBe(
      "Set your tolerance for this test before you release a result.",
    );
  });

  it("names every source and every state", () => {
    expect(measurementSourceLabel("afinion")).toBe("Afinion 2");
    expect(measurementSourceLabel("epoch_upload")).toBe("Epoch 2 upload");
    expect(measurementSourceLabel("manual")).toBe("By hand");
    expect(requestedTestStateLabel("requested")).toBe("Requested");
    expect(requestedTestStateLabel("measured")).toBe("Measured");
    expect(requestedTestStateLabel("released")).toBe("Released");
  });

  it("warns in words below and above the tolerance, and not inside it (S15, Q-ACC-2)", () => {
    expect(toleranceWarning("inside", LIMITS)).toBeNull();
    expect(toleranceWarning("below", LIMITS)).toBe(
      "The value is below your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    );
    expect(toleranceWarning("above", LIMITS)).toBe(
      "The value is above your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    );
  });
});

describe("releaseVerdict (S15; UI review of #374, S4)", () => {
  const tolerance = { lower: "4", upper: "6" };

  it("is inside on a limit and outside past it, with the words of the warning", () => {
    expect(releaseVerdict("4.000000", tolerance, "mmol/L")).toEqual({
      kind: "inside",
      text: "The value is inside your tolerance of 4 to 6 mmol/L.",
    });
    expect(releaseVerdict("3.9", tolerance, "mmol/L")).toEqual({
      kind: "outside",
      text: "The value is below your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    });
  });

  it("is unreadable for a value the check cannot read, so nothing is released", () => {
    for (const value of ["1e5", "1234567890", "NaN"]) {
      expect(releaseVerdict(value, tolerance, null)).toEqual({
        kind: "unreadable",
        text: "This value cannot be checked against your tolerance, so it cannot be released. Enter the measurement again.",
      });
    }
  });
});
