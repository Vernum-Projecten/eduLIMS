// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseLimitKind, parsePastedRows } from "./correct-values.ts";

const GLUCOSE = "0190a000-0000-7000-8000-000000000001";
const UREA = "0190a000-0000-7000-8000-000000000002";
const TESTS = [
  { id: GLUCOSE, name: "Glucose" },
  { id: UREA, name: "Urea" },
];

describe("parsePastedRows (D10)", () => {
  it("reads tab-separated lines copied from a spreadsheet, the test by name in any case", () => {
    expect(parsePastedRows("S-001\tglucose\t5,2\nS-002\tUREA\t7.1", TESTS)).toEqual({
      rows: [
        { sampleNumber: "S-001", testId: GLUCOSE, value: "5,2" },
        { sampleNumber: "S-002", testId: UREA, value: "7.1" },
      ],
      problems: [],
    });
  });

  it("reads semicolon-separated lines and skips blank lines, keeping line numbers", () => {
    const { rows, problems } = parsePastedRows(
      "\n S-001 ; Glucose ; 5.2 \r\n\r\nS-003;Urea;x",
      TESTS,
    );
    expect(rows).toEqual([{ sampleNumber: "S-001", testId: GLUCOSE, value: "5.2" }]);
    expect(problems).toEqual([{ line: 4, reason: "number", text: "" }]);
  });

  it("names each line that does not read, and why", () => {
    const text = [
      "S-001\tGlucose",
      "S-002\tAlbumin\t1",
      "\tGlucose\t1",
      `${"S".repeat(41)}\tGlucose\t1`,
      "S\u0007\tGlucose\t1",
      "S-006\tGlucose\t1",
      "s-006\tglucose\t2",
    ].join("\n");
    expect(parsePastedRows(text, TESTS).problems).toEqual([
      { line: 1, reason: "columns", text: "" },
      { line: 2, reason: "unknown_test", text: "Albumin" },
      { line: 3, reason: "sample_number", text: "" },
      { line: 4, reason: "sample_number", text: "" },
      { line: 5, reason: "sample_number", text: "" },
      { line: 7, reason: "repeated", text: "" },
    ]);
  });

  it("quotes at most 40 characters of an unknown test name", () => {
    const { problems } = parsePastedRows(`S-1\t${"X".repeat(60)}\t1`, TESTS);
    expect(problems[0]?.text).toBe(`${"X".repeat(40)}…`);
  });

  it("reads nothing from an empty paste", () => {
    expect(parsePastedRows("  \n\n", TESTS)).toEqual({ rows: [], problems: [] });
  });
});

describe("parseLimitKind (D13)", () => {
  it("knows the two kinds and nothing else", () => {
    expect(parseLimitKind("percent")).toBe("percent");
    expect(parseLimitKind("absolute")).toBe("absolute");
    expect(parseLimitKind("relative")).toBeUndefined();
  });
});
