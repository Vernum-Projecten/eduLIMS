// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { maxOf, sqrtRadiusScale } from "./radius-scale";

describe("sqrtRadiusScale", () => {
  it("maps zero to the minimum and the maximum to the largest radius", () => {
    const r = sqrtRadiusScale(100, [3, 18]);
    expect(r(0)).toBe(3);
    expect(r(100)).toBe(18);
  });

  it("grows the radius with the square root of the value, not linearly", () => {
    const r = sqrtRadiusScale(100, [0, 20]);
    expect(r(25)).toBeCloseTo(10);
    expect(r(4)).toBeCloseTo(4);
  });

  it("keeps the point area proportional to the value when the range starts at zero", () => {
    const r = sqrtRadiusScale(64, [0, 16]);
    const area = (value: number) => Math.PI * r(value) ** 2;
    expect(area(32) / area(16)).toBeCloseTo(2);
  });

  it("clamps values above the maximum and below zero to the range", () => {
    const r = sqrtRadiusScale(50, [2, 10]);
    expect(r(200)).toBe(10);
    expect(r(-5)).toBe(2);
  });

  it("refuses a maximum that is not above zero", () => {
    expect(() => sqrtRadiusScale(0, [2, 10])).toThrow(RangeError);
    expect(() => sqrtRadiusScale(Number.NaN, [2, 10])).toThrow(RangeError);
  });

  it("refuses a descending or negative range", () => {
    expect(() => sqrtRadiusScale(10, [12, 4])).toThrow(RangeError);
    expect(() => sqrtRadiusScale(10, [-1, 4])).toThrow(RangeError);
    expect(() => sqrtRadiusScale(10, [1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("maxOf", () => {
  it("returns the largest finite value", () => {
    expect(maxOf([3, 41, 7, Number.NaN])).toBe(41);
  });

  it("returns undefined when there is no finite value", () => {
    expect(maxOf([])).toBeUndefined();
    expect(maxOf([Number.NaN])).toBeUndefined();
  });
});
