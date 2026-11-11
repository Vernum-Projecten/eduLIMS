// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dayIn, endOfDayIn } from "./app-day.ts";

describe("dayIn", () => {
  it("returns the calendar date in the app's time zone, not in UTC", () => {
    expect(dayIn(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
    expect(dayIn(new Date("2026-11-11T22:30:00Z"), "UTC")).toBe("2026-11-11");
  });
});

describe("endOfDayIn", () => {
  it("returns midnight after the day in Europe/Amsterdam, in winter and summer time", () => {
    expect(endOfDayIn("2026-11-11").toISOString()).toBe("2026-11-11T23:00:00.000Z");
    expect(endOfDayIn("2026-07-01").toISOString()).toBe("2026-07-01T22:00:00.000Z");
  });

  it("handles the days the clocks change", () => {
    expect(endOfDayIn("2026-03-28").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(endOfDayIn("2026-03-29").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(endOfDayIn("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("throws for anything but YYYY-MM-DD", () => {
    expect(() => endOfDayIn("11-11-2026")).toThrow(RangeError);
  });
});
