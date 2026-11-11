// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "./format";

// 2026-03-29T00:30Z is 01:30 in Amsterdam (CET), and 2026-07-01T12:00Z is 14:00 (CEST).
const WINTER = "2026-03-29T00:30:00Z";
const SUMMER = new Date("2026-07-01T12:00:00Z");

describe("formatDateTime", () => {
  it("shows the time in Europe/Amsterdam, whatever the process time zone", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Amsterdam");
    expect(formatDateTime(WINTER, { locale: "en" })).toContain("1:30");
    expect(formatDateTime(SUMMER, { locale: "nl" })).toContain("14:00");
  });

  it("follows the locale's date conventions", () => {
    expect(formatDateTime(SUMMER, { locale: "en" })).toMatch(/Jul 1, 2026/);
    expect(formatDateTime(SUMMER, { locale: "nl" })).toMatch(/1 jul 2026/);
  });

  it("uses the active locale (English outside a request) by default", () => {
    expect(formatDateTime(SUMMER)).toBe(formatDateTime(SUMMER, { locale: "en" }));
  });

  it("rejects an invalid date instead of printing 'Invalid Date'", () => {
    expect(() => formatDateTime("not a date")).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  it("writes the month name in the locale", () => {
    expect(formatDate(SUMMER, { locale: "en" })).toBe("July 1, 2026");
    expect(formatDate(SUMMER, { locale: "nl" })).toBe("1 juli 2026");
  });

  it("uses the Amsterdam calendar day near midnight UTC", () => {
    expect(formatDate("2026-07-01T23:30:00Z", { locale: "nl" })).toBe("2 juli 2026");
  });

  it("rejects an invalid date", () => {
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("formatNumber", () => {
  it("uses the decimal and grouping separators of the locale", () => {
    expect(formatNumber(1234.5, { locale: "en" })).toBe("1,234.5");
    expect(formatNumber(1234.5, { locale: "nl" })).toBe("1.234,5");
  });

  it("rounds to two decimals unless told otherwise", () => {
    expect(formatNumber(0.12345, { locale: "en" })).toBe("0.12");
    expect(formatNumber(0.12345, { locale: "nl", maximumFractionDigits: 3 })).toBe("0,123");
    expect(formatNumber(2)).toBe("2");
  });
});

describe("formatRelativeTime", () => {
  const from = "2026-11-11T12:00:00Z";

  it("uses the largest whole unit, before and after", () => {
    expect(formatRelativeTime("2026-11-08T12:00:00Z", from, { locale: "en" })).toBe("3 days ago");
    expect(formatRelativeTime("2026-11-11T14:30:00Z", from, { locale: "en" })).toBe("in 2 hours");
    expect(formatRelativeTime("2026-11-10T12:00:00Z", from, { locale: "nl" })).toBe("gisteren");
  });

  it("says now under a minute", () => {
    expect(formatRelativeTime("2026-11-11T11:59:30Z", from, { locale: "en" })).toBe("now");
  });
});
