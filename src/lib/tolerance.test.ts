// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { checkTolerance, sameTolerance } from "./tolerance.ts";

// Invented limits (Q-PRIV-4).
const TOLERANCE = { lower: "4.2", upper: "6.35" };

describe("checkTolerance (S13, S15)", () => {
  it("puts a value exactly on the lower limit inside (S13)", () => {
    expect(checkTolerance("4.2", TOLERANCE)).toBe("inside");
  });

  it("puts a value exactly on the upper limit inside (S13)", () => {
    expect(checkTolerance("6.35", TOLERANCE)).toBe("inside");
  });

  it("puts a value just inside each limit inside", () => {
    expect(checkTolerance("4.200001", TOLERANCE)).toBe("inside");
    expect(checkTolerance("6.349999", TOLERANCE)).toBe("inside");
  });

  it("puts a value just below the lower limit below", () => {
    expect(checkTolerance("4.199999", TOLERANCE)).toBe("below");
  });

  it("puts a value just above the upper limit above", () => {
    expect(checkTolerance("6.350001", TOLERANCE)).toBe("above");
  });

  it("compares as decimals, never as floats", () => {
    expect(checkTolerance("4.20", TOLERANCE)).toBe("inside");
    expect(checkTolerance("0.3", { lower: "0.1", upper: "0.3" })).toBe("inside");
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    expect(checkTolerance("0.300001", { lower: "0.1", upper: "0.3" })).toBe("above");
  });

  it("reads a decimal comma as the separator", () => {
    expect(checkTolerance("6,35", TOLERANCE)).toBe("inside");
  });

  it("handles negative limits and a tolerance of one value", () => {
    expect(checkTolerance("-1.5", { lower: "-2", upper: "-1" })).toBe("inside");
    expect(checkTolerance("-0.5", { lower: "-2", upper: "-1" })).toBe("above");
    expect(checkTolerance("5", { lower: "5.0", upper: "5" })).toBe("inside");
    expect(checkTolerance("5.000001", { lower: "5", upper: "5" })).toBe("above");
  });

  it("throws a RangeError for a value that is no number", () => {
    expect(() => checkTolerance("abc", TOLERANCE)).toThrow(RangeError);
    expect(() => checkTolerance("5", { lower: "x", upper: "6" })).toThrow(RangeError);
  });
});

describe("sameTolerance", () => {
  it("compares both limits as decimals", () => {
    expect(sameTolerance({ lower: "4.20", upper: "6" }, { lower: "4.2", upper: "6.000" })).toBe(
      true,
    );
    expect(sameTolerance({ lower: "4.2", upper: "6" }, { lower: "4.2", upper: "6.1" })).toBe(false);
    expect(sameTolerance({ lower: "4.1", upper: "6" }, { lower: "4.2", upper: "6" })).toBe(false);
  });
});
