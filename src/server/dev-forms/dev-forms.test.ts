// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEMO_REQUEST, DEMO_SESSION } from "@/components/dev-forms/demo-data";
import { isTakenDemoSampleNumber, reviewDemoRequest, reviewDemoSession } from "./demo.ts";
import { demoRequestSchema, demoSampleNumberInput, demoSessionSchema } from "./schemas.ts";

describe("the fictional sample numbers", () => {
  it("counts a fictional sample number as taken, ignoring case and spaces", () => {
    expect(isTakenDemoSampleNumber("  demo-101 ")).toBe(true);
    expect(isTakenDemoSampleNumber("DEMO-103")).toBe(false);
  });

  it("refuses a taken sample number at submit and accepts a free one", () => {
    expect(reviewDemoRequest({ sampleNumber: "DEMO-102" })).toEqual({
      ok: false,
      refusal: { kind: "sample_number_taken" },
    });
    expect(reviewDemoRequest({ sampleNumber: "DEMO-103" })).toEqual({ ok: true });
  });

  it("refuses a session only when the refusal is simulated", () => {
    expect(reviewDemoSession({ simulateRefusal: true })).toEqual({
      ok: false,
      refusal: { kind: "simulated" },
    });
    expect(reviewDemoSession({ simulateRefusal: false })).toEqual({ ok: true });
  });
});

/** Returns the messages of a failed parse by field path, as TanStack Form maps them. */
function issuesByPath(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]);
}

describe("demoRequestSchema (the shared schema of the request editor)", () => {
  it("accepts the fictional request", () => {
    expect(demoRequestSchema.safeParse(DEMO_REQUEST).success).toBe(true);
  });

  it("refuses an empty sample number, an empty test name and a bad value at their nested paths", () => {
    const test = DEMO_REQUEST.tests[0];
    if (!test) throw new Error("the fictional request has tests");
    const result = demoRequestSchema.safeParse({
      sampleNumber: " ",
      tests: [
        {
          ...test,
          name: "",
          measurements: [{ id: "r", label: "Run 1", value: Number.NaN }],
        },
      ],
    });
    expect(issuesByPath(result)).toEqual([
      ["sampleNumber", "Enter the sample number."],
      ["tests.0.name", "Enter a name for the test."],
      ["tests.0.measurements.0.value", "Enter the value as a number from 0 to 1000."],
    ]);
  });

  it("refuses a request without tests and a test without measurements", () => {
    expect(issuesByPath(demoRequestSchema.safeParse({ sampleNumber: "A", tests: [] }))).toEqual([
      ["tests", "Add at least one test."],
    ]);
    expect(
      issuesByPath(
        demoRequestSchema.safeParse({
          sampleNumber: "A",
          tests: [{ id: "t", name: "B", measurements: [] }],
        }),
      ),
    ).toEqual([["tests.0.measurements", "Add at least one measurement."]]);
  });

  it("refuses a value outside 0 to 1000 and accepts a decimal inside", () => {
    const request = (value: number) => ({
      sampleNumber: "A",
      tests: [{ id: "t", name: "B", measurements: [{ id: "r", label: "C", value }] }],
    });
    for (const value of [-0.1, 1000.1, Number.POSITIVE_INFINITY]) {
      expect(demoRequestSchema.safeParse(request(value)).success).toBe(false);
    }
    for (const value of [0, 5.4, 1000]) {
      expect(demoRequestSchema.safeParse(request(value)).success).toBe(true);
    }
  });

  it("bounds the sample number check input like the form (a server function is an API)", () => {
    expect(demoSampleNumberInput.safeParse({ sampleNumber: "x".repeat(41) }).success).toBe(false);
    expect(demoSampleNumberInput.safeParse({ sampleNumber: "x".repeat(40) }).success).toBe(true);
    expect(demoSampleNumberInput.safeParse({ sampleNumber: "A", extra: 1 }).success).toBe(false);
  });
});

describe("demoSessionSchema (the shared schema of the session form)", () => {
  it("refuses the empty form with a message per required field", () => {
    expect(issuesByPath(demoSessionSchema.safeParse(DEMO_SESSION))).toEqual([
      ["name", "Enter a name for the session."],
      ["groupSize", "Enter the group size as a whole number from 1 to 30."],
      ["analyser", "Choose an analyser."],
      ["part", "Choose a part of the day."],
      ["measurements", "Choose at least one measurement."],
      ["day", "Choose the day of the session."],
    ]);
  });

  it("accepts a filled form", () => {
    expect(
      demoSessionSchema.safeParse({
        ...DEMO_SESSION,
        name: "Group A",
        groupSize: 12,
        analyser: "epoch",
        part: "morning",
        measurements: ["absorbance"],
        day: "2026-12-01",
        observers: ["observer@example.test"],
      }).success,
    ).toBe(true);
  });
});
