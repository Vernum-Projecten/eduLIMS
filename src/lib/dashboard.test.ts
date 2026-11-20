// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The dashboard measures (G-01, G-03, D13) and the board's order (owner 2026-11-20, #271). Each
// limit is tested exactly on it, just inside and just outside, as a percentage and as an absolute
// distance; nothing is compared as a float.
import { describe, expect, it } from "vitest";
import type { AccuracyLimits } from "./correct-values.ts";
import {
  type AccuracyStatus,
  accuracyStatus,
  type BoardStanding,
  compareStandings,
  median,
  orderBoard,
  turnaroundMs,
} from "./dashboard.ts";

describe("accuracyStatus with absolute limits (G-03, D13)", () => {
  const limits: AccuracyLimits = { kind: "absolute", yellow: "0.2", red: "0.5" };
  const cases: [string, string, AccuracyStatus][] = [
    ["equal to the correct value", "5", "green"],
    ["just inside the yellow limit", "5.199999", "green"],
    ["exactly on the yellow limit, above", "5.2", "green"],
    ["exactly on the yellow limit, below", "4.8", "green"],
    ["just outside the yellow limit", "5.200001", "yellow"],
    ["just inside the red limit", "5.499999", "yellow"],
    ["exactly on the red limit, above", "5.5", "yellow"],
    ["exactly on the red limit, below", "4.5", "yellow"],
    ["just outside the red limit, above", "5.500001", "red"],
    ["just outside the red limit, below", "4.499999", "red"],
  ];
  it.each(cases)("is %s: %s gives %s", (_, value, status) => {
    expect(accuracyStatus(value, "5", limits)).toBe(status);
  });

  it("reads a comma and trailing zeros as the same decimal", () => {
    expect(accuracyStatus("5,20", "5.000", limits)).toBe("green");
  });
});

describe("accuracyStatus with percentage limits (G-03, D13)", () => {
  // 2% and 5% of 50 are 1 and 2.5.
  const limits: AccuracyLimits = { kind: "percent", yellow: "2", red: "5" };
  const cases: [string, string, AccuracyStatus][] = [
    ["just inside the yellow limit", "50.999999", "green"],
    ["exactly on the yellow limit, above", "51", "green"],
    ["exactly on the yellow limit, below", "49", "green"],
    ["just outside the yellow limit", "51.000001", "yellow"],
    ["just inside the red limit", "52.499999", "yellow"],
    ["exactly on the red limit, above", "52.5", "yellow"],
    ["exactly on the red limit, below", "47.5", "yellow"],
    ["just outside the red limit", "52.500001", "red"],
    ["just outside the red limit, below", "47.499999", "red"],
  ];
  it.each(cases)("is %s: %s gives %s", (_, value, status) => {
    expect(accuracyStatus(value, "50", limits)).toBe(status);
  });

  it("takes the percentage of the size of a negative correct value", () => {
    expect(accuracyStatus("-51", "-50", limits)).toBe("green");
    expect(accuracyStatus("-52.6", "-50", limits)).toBe("red");
  });

  it("is green only for the exact value when the correct value is zero", () => {
    expect(accuracyStatus("0", "0", limits)).toBe("green");
    expect(accuracyStatus("0.000001", "0", limits)).toBe("red");
  });

  it("stays exact where a binary float is not (0.1 + 0.2)", () => {
    // 10% of 3 is 0.3; 3.3 lies exactly on it.
    expect(accuracyStatus("3.3", "3", { kind: "percent", yellow: "10", red: "20" })).toBe("green");
  });
});

describe("accuracyStatus refuses to guess", () => {
  const limits: AccuracyLimits = { kind: "absolute", yellow: "1", red: "2" };
  it.each([
    ["a value in exponent form", "1e3", "5"],
    ["a value with seven decimals", "5.0000001", "5"],
    ["a correct value that is no number", "5", "five"],
  ])("returns null for %s", (_, value, correct) => {
    expect(accuracyStatus(value, correct, limits)).toBeNull();
  });

  it("returns null for a limit that is no number", () => {
    expect(accuracyStatus("5", "5", { kind: "absolute", yellow: "x", red: "2" })).toBeNull();
  });
});

describe("turnaroundMs (G-01, Q-SIM-2)", () => {
  it("is the time from the entry of the request to the release", () => {
    expect(turnaroundMs("2026-11-20T09:00:00.000Z", "2026-11-20T09:42:30.500Z")).toBe(2_550_500);
  });

  it("refuses an instant that is no date", () => {
    expect(() => turnaroundMs("yesterday", "2026-11-20T09:00:00Z")).toThrow(RangeError);
  });
});

describe("median", () => {
  it("is null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("is the middle value of an odd count, whatever the order", () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it("is the rounded mean of the two middle values of an even count", () => {
    expect(median([10, 21, 40, 1])).toBe(16);
  });
});

function lab(over: Partial<BoardStanding> & { name: string }): BoardStanding {
  return { labId: over.name, green: 0, red: 0, medianTurnaroundMs: null, ...over };
}

describe("the board's order (owner 2026-11-20, #271)", () => {
  it("puts most green first", () => {
    const order = [lab({ name: "A", green: 1 }), lab({ name: "B", green: 3 })].sort(
      compareStandings,
    );
    expect(order.map((row) => row.name)).toEqual(["B", "A"]);
  });

  it("then fewest red", () => {
    const order = [lab({ name: "A", green: 2, red: 2 }), lab({ name: "B", green: 2, red: 1 })].sort(
      compareStandings,
    );
    expect(order.map((row) => row.name)).toEqual(["B", "A"]);
  });

  it("then the shortest median turnaround, a lab without one last", () => {
    const order = [
      lab({ name: "A", medianTurnaroundMs: null }),
      lab({ name: "B", medianTurnaroundMs: 9_000 }),
      lab({ name: "C", medianTurnaroundMs: 3_000 }),
    ].sort(compareStandings);
    expect(order.map((row) => row.name)).toEqual(["C", "B", "A"]);
  });

  it("then the lab name, and the id for two equal names", () => {
    const order = [
      lab({ name: "Beta", labId: "2" }),
      lab({ name: "alpha", labId: "9" }),
      lab({ name: "Beta", labId: "1" }),
    ].sort(compareStandings);
    expect(order.map((row) => [row.name, row.labId])).toEqual([
      ["alpha", "9"],
      ["Beta", "1"],
      ["Beta", "2"],
    ]);
  });

  it("numbers the positions in the board's order, also when sorted by name", () => {
    const labs = [lab({ name: "Alpha", green: 1 }), lab({ name: "Zulu", green: 4 })];
    expect(orderBoard(labs, "board").map((row) => [row.name, row.position])).toEqual([
      ["Zulu", 1],
      ["Alpha", 2],
    ]);
    expect(orderBoard(labs, "name").map((row) => [row.name, row.position])).toEqual([
      ["Alpha", 2],
      ["Zulu", 1],
    ]);
  });
});
