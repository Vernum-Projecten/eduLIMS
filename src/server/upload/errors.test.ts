// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { boundText } from "./errors.ts";
import { MAX_ERROR_TEXT } from "./limits.ts";

describe("boundText (ASVS 5.0 V16.5.1)", () => {
  it("keeps text of at most the bound", () => {
    expect(boundText("x".repeat(MAX_ERROR_TEXT))).toBe("x".repeat(MAX_ERROR_TEXT));
  });

  it("cuts longer text to the bound", () => {
    expect(boundText("x".repeat(MAX_ERROR_TEXT + 1))).toHaveLength(MAX_ERROR_TEXT);
  });

  it("does not split a surrogate pair at the cut", () => {
    const text = `${"x".repeat(MAX_ERROR_TEXT - 1)}${String.fromCodePoint(0x1f600)}`;
    expect(boundText(text)).toBe("x".repeat(MAX_ERROR_TEXT - 1));
  });
});
