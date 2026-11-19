// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { plainDecimal, readCellNumber } from "./decimal.ts";

describe("readCellNumber", () => {
  it.each([
    ["4.2000000000000003E-2", "0.042"],
    ["0.61053240740740744", "0.6105324074074074"],
    ["19.600000000000001", "19.6"],
    ["750", "750"],
    ["-1.5e2", "-150"],
    [".5", "0.5"],
    ["5.", "5"],
    ["+3", "3"],
    ["-0", "0"],
    ["0e-400", "0"],
    ["1.50000000000000000000", "1.5"],
    ["0.00012345678901234567", "0.00012345678901234567"],
  ])("reads %s as %s", (raw, text) => {
    expect(readCellNumber(raw)).toEqual({ text, value: Number(text) });
  });

  it.each([
    "",
    "abc",
    "1,5",
    "INF",
    "NaN",
    "1e",
    "0x10",
    " 1",
    "1e999",
    "1e-400",
    "-1e-400",
    "0.000123456789012345678",
    "123456789012345678",
  ])("refuses %j", (raw) => {
    expect(readCellNumber(raw)).toBeUndefined();
  });
});

describe("plainDecimal", () => {
  it.each([
    [1e-7, "0.0000001"],
    [1.5e-7, "0.00000015"],
    [-2.5e-9, "-0.0000000025"],
    [1e21, "1000000000000000000000"],
    [1.25e22, "12500000000000000000000"],
    [0.1 + 0.2, "0.30000000000000004"],
    [-0, "0"],
  ])("writes %d as %s", (value, text) => {
    expect(plainDecimal(value)).toBe(text);
    expect(Number(text)).toBe(Object.is(value, -0) ? 0 : value);
  });
});
