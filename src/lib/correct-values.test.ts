// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseLimitKind, parsePastedGrid } from "./correct-values.ts";

const GLUCOSE = "0190a000-0000-7000-8000-000000000001";
const UREA = "0190a000-0000-7000-8000-000000000002";
const TESTS = [
  { id: GLUCOSE, name: "Glucose" },
  { id: UREA, name: "Urea" },
];

describe("parsePastedGrid (D10, #401)", () => {
  it("reads a tab-separated grid: tests by name in any case, samples by row, values by cell", () => {
    const grid = parsePastedGrid("Sample\tglucose\tUREA\nS-1\t5,2\t7.1\nS-2\t6\t\n", TESTS);
    expect(grid.problems).toEqual([]);
    expect(grid.columns).toEqual([
      { text: "glucose", testId: GLUCOSE },
      { text: "UREA", testId: UREA },
    ]);
    expect(grid.rows).toEqual([
      { sampleNumber: "S-1", testId: GLUCOSE, value: "5,2" },
      { sampleNumber: "S-1", testId: UREA, value: "7.1" },
      { sampleNumber: "S-2", testId: GLUCOSE, value: "6" },
    ]);
  });

  it("reads semicolons, skips blank lines and an empty cell, which is not requested", () => {
    const grid = parsePastedGrid("Sample;Glucose;Urea\n\nS-1;;4\n", TESTS);
    expect(grid.problems).toEqual([]);
    expect(grid.rows).toEqual([{ sampleNumber: "S-1", testId: UREA, value: "4" }]);
    expect(grid.samples).toEqual([{ sampleNumber: "S-1", cells: ["", "4"] }]);
  });

  it("refuses an unknown, an empty and a repeated test at its header, never creating one", () => {
    const grid = parsePastedGrid(`Sample\tAlbumin\t\tGlucose\tglucose\nS-1\t1\t2\t3\t4`, TESTS);
    expect(grid.problems).toEqual([
      { kind: "header", column: 1, reason: "unknown_test", text: "Albumin" },
      { kind: "header", column: 2, reason: "empty_test", text: "" },
      { kind: "header", column: 4, reason: "repeated_test", text: "" },
    ]);
    expect(grid.rows).toEqual([{ sampleNumber: "S-1", testId: GLUCOSE, value: "3" }]);
  });

  it("refuses a bad sample number, a repeated sample and a row wider than the header", () => {
    const long = "S".repeat(41);
    const grid = parsePastedGrid(`Sample\tGlucose\n${long}\t1\nS-1\t2\ns-1\t3\nS-2\t4\t5`, TESTS);
    expect(grid.problems).toEqual([
      { kind: "row", row: 1, reason: "sample_number" },
      { kind: "row", row: 3, reason: "repeated_sample" },
      { kind: "row", row: 4, reason: "columns" },
    ]);
    expect(grid.rows).toEqual([{ sampleNumber: "S-1", testId: GLUCOSE, value: "2" }]);
  });

  it("refuses a value that is no number at its cell", () => {
    const grid = parsePastedGrid("Sample\tGlucose\tUrea\nS-1\t5\tlow", TESTS);
    expect(grid.problems).toEqual([{ kind: "cell", row: 1, column: 2, reason: "number" }]);
  });

  it("quotes at most 40 characters of an unknown test name", () => {
    const name = "X".repeat(60);
    const [problem] = parsePastedGrid(`Sample\t${name}`, TESTS).problems;
    expect(problem).toEqual({
      kind: "header",
      column: 1,
      reason: "unknown_test",
      text: `${"X".repeat(40)}…`,
    });
  });

  it("reads nothing from an empty paste", () => {
    expect(parsePastedGrid("  \n\n", TESTS)).toEqual({
      columns: [],
      samples: [],
      rows: [],
      problems: [],
    });
  });
});

describe("parseLimitKind (D13)", () => {
  it("knows the two kinds and nothing else", () => {
    expect(parseLimitKind("percent")).toBe("percent");
    expect(parseLimitKind("absolute")).toBe("absolute");
    expect(parseLimitKind("relative")).toBeUndefined();
  });
});
