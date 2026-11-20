// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toleranceErrorMessage } from "./tolerance-labels.ts";

describe("toleranceErrorMessage (S13)", () => {
  it("says each refusal in the student's words", () => {
    expect(toleranceErrorMessage("not_found")).toBe(
      "This lab no longer exists, or you are not in it.",
    );
    expect(toleranceErrorMessage("not_running")).toBe(
      "Your lab's simulation is not running, so its tolerances cannot change.",
    );
    expect(toleranceErrorMessage("test_not_found")).toBe(
      "This test is no longer in the catalogue. Reload the page.",
    );
    expect(toleranceErrorMessage("test_retired")).toBe(
      "This test is retired, so your lab cannot set a first tolerance for it.",
    );
  });

  it("falls back to the general failure for anything else, never a teacher's message", () => {
    expect(toleranceErrorMessage(null)).toBe("The tolerance could not be saved. Try again.");
    expect(toleranceErrorMessage("missing_limits")).toBe(
      "The tolerance could not be saved. Try again.",
    );
  });
});
