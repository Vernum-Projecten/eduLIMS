// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CHART_PALETTE_SIZE, chartSeriesColor } from "./palette";

describe("chartSeriesColor", () => {
  it("paints the first series with the first theme colour", () => {
    expect(chartSeriesColor(0)).toBe("var(--ts-chart-1)");
  });

  it("wraps around after the last theme colour", () => {
    expect(chartSeriesColor(CHART_PALETTE_SIZE)).toBe("var(--ts-chart-1)");
    expect(chartSeriesColor(CHART_PALETTE_SIZE - 1)).toBe(`var(--ts-chart-${CHART_PALETTE_SIZE})`);
  });

  it("refuses a negative or fractional index", () => {
    expect(() => chartSeriesColor(-1)).toThrow(RangeError);
    expect(() => chartSeriesColor(1.5)).toThrow(RangeError);
  });
});
