// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEMO_RUBRIC, DEMO_SESSION } from "@/components/dev-forms/demo-data";
import { isTakenDemoTitle, reviewDemoRubric, reviewDemoSession } from "./demo.ts";
import { demoRubricSchema, demoSessionSchema, demoTitleInput } from "./schemas.ts";

describe("the fictional rubric titles", () => {
  it("counts a fictional title as taken, ignoring case and spaces", () => {
    expect(isTakenDemoTitle("  titration BASICS ")).toBe(true);
    expect(isTakenDemoTitle("Pipetting technique")).toBe(false);
  });

  it("refuses a taken title at submit and accepts a free one", () => {
    expect(reviewDemoRubric({ title: "Microplate absorbance" })).toEqual({
      ok: false,
      refusal: { kind: "title_taken" },
    });
    expect(reviewDemoRubric({ title: "Pipetting technique" })).toEqual({ ok: true });
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

describe("demoRubricSchema (the shared schema of the rubric editor)", () => {
  it("accepts the fictional rubric", () => {
    expect(demoRubricSchema.safeParse(DEMO_RUBRIC).success).toBe(true);
  });

  it("refuses an empty title, an empty criterion name and bad points at their nested paths", () => {
    const criterion = DEMO_RUBRIC.criteria[0];
    if (!criterion) throw new Error("the fictional rubric has criteria");
    const result = demoRubricSchema.safeParse({
      title: " ",
      criteria: [
        {
          ...criterion,
          name: "",
          levels: [{ id: "l", label: "Good", points: Number.NaN }],
        },
      ],
    });
    expect(issuesByPath(result)).toEqual([
      ["title", "Enter a title for the rubric."],
      ["criteria.0.name", "Enter a name for the criterion."],
      ["criteria.0.levels.0.points", "Enter the points as a whole number from 0 to 100."],
    ]);
  });

  it("refuses a rubric without criteria and a criterion without levels", () => {
    expect(issuesByPath(demoRubricSchema.safeParse({ title: "A", criteria: [] }))).toEqual([
      ["criteria", "Add at least one criterion."],
    ]);
    expect(
      issuesByPath(
        demoRubricSchema.safeParse({
          title: "A",
          criteria: [{ id: "c", name: "B", levels: [] }],
        }),
      ),
    ).toEqual([["criteria.0.levels", "Add at least one level."]]);
  });

  it("refuses points outside 0 to 100 and fractions", () => {
    for (const points of [-1, 101, 1.5]) {
      const result = demoRubricSchema.safeParse({
        title: "A",
        criteria: [{ id: "c", name: "B", levels: [{ id: "l", label: "C", points }] }],
      });
      expect(result.success).toBe(false);
    }
  });

  it("bounds the title check input like the form (a server function is an API)", () => {
    expect(demoTitleInput.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(demoTitleInput.safeParse({ title: "A", extra: 1 }).success).toBe(false);
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
