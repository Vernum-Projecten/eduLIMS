// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { compareDecimals, isNegativeDecimal, parseDecimal } from "./decimal.ts";

describe("parseDecimal (D10, D13)", () => {
  it.each([
    ["5.2", "5.2"],
    ["5,2", "5.2"],
    ["  6.50 ", "6.50"],
    ["+7", "7"],
    ["007.10", "7.10"],
    ["-0.75", "-0.75"],
    ["-0", "0"],
    ["-0.000", "0.000"],
    ["0", "0"],
    ["999999999.999999", "999999999.999999"],
  ])("reads %j as %j", (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "1e3",
    "1.2.3",
    "1,000.5",
    "1 000",
    ".5",
    "5.",
    "1234567890",
    "1.1234567",
    "NaN",
    "Infinity",
  ])("refuses %j", (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe("compareDecimals: digits, never floats (D13)", () => {
  it("finds 0.1 + 0.2 style values equal where floats do not", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(compareDecimals("0.30", "0.3")).toBe(0);
  });

  it("orders values across signs and fractions", () => {
    expect(compareDecimals("5.45", "5.5")).toBe(-1);
    expect(compareDecimals("5.55", "5.5")).toBe(1);
    expect(compareDecimals("-1", "0.000001")).toBe(-1);
    expect(compareDecimals("-0.5", "-0.25")).toBe(-1);
    expect(compareDecimals("999999999.999999", "999999999.999998")).toBe(1);
  });

  it("reads a comma as the decimal separator", () => {
    expect(compareDecimals("5,2", "5.20")).toBe(0);
  });

  it("throws a RangeError on something that is no decimal", () => {
    expect(() => compareDecimals("x", "1")).toThrow(RangeError);
    expect(() => compareDecimals("1", "1e2")).toThrow(RangeError);
  });

  it("tells a negative value", () => {
    expect(isNegativeDecimal("-0.000001")).toBe(true);
    expect(isNegativeDecimal("0")).toBe(false);
    expect(isNegativeDecimal("-0")).toBe(false);
  });
});
