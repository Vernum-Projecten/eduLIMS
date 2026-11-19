// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The form and the inputs of the test catalogue (D9, S4, #266): the client and the server refuse
// the same input, and a setting of another source never reaches the service.
import { describe, expect, it } from "vitest";
import {
  createTestInput,
  listTestsInput,
  type TestForm,
  testFormSchema,
  testIdInput,
  testListSearchSchema,
  updateTestInput,
} from "./schemas.ts";

const FORM: TestForm = {
  name: "  HbA1c ",
  unit: "%",
  material: "blood",
  source: "afinion",
  analyte: " HbA1c ",
  calculatedBy: "",
};

function issuePaths(input: unknown): string[] {
  const result = testFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("testFormSchema (D9)", () => {
  it("accepts an Afinion 2 test and trims its text", () => {
    expect(testFormSchema.parse(FORM)).toMatchObject({ name: "HbA1c", analyte: "HbA1c" });
  });

  it("names every missing field of an empty form", () => {
    expect(
      issuePaths({ name: "", unit: " ", material: "", source: "", analyte: "", calculatedBy: "" }),
    ).toEqual(["name", "material", "source"]);
  });

  it("takes an empty unit for a dimensionless result (maintainer 2026-11-19)", () => {
    expect(issuePaths({ ...FORM, unit: "   " })).toEqual([]);
  });

  it("requires the analyte of an Afinion 2 test only", () => {
    expect(issuePaths({ ...FORM, analyte: "" })).toEqual(["analyte"]);
    expect(issuePaths({ ...FORM, source: "manual", analyte: "" })).toEqual([]);
  });

  it("refuses an analyte with an HL7 delimiter", () => {
    for (const analyte of ["CR|P", "A^B", "A~B", "A\\B", "A&B"]) {
      expect(issuePaths({ ...FORM, analyte }), analyte).toEqual(["analyte"]);
    }
  });

  it("requires who calculates for an Epoch 2 test only (S4)", () => {
    expect(issuePaths({ ...FORM, source: "epoch_upload" })).toEqual(["calculatedBy"]);
    expect(issuePaths({ ...FORM, source: "epoch_upload", calculatedBy: "team" })).toEqual([]);
  });

  it("refuses text over its bound", () => {
    expect(issuePaths({ ...FORM, name: "x".repeat(81) })).toEqual(["name"]);
    expect(issuePaths({ ...FORM, unit: "x".repeat(21) })).toEqual(["unit"]);
    expect(issuePaths({ ...FORM, material: "x".repeat(41) })).toEqual(["material"]);
    expect(issuePaths({ ...FORM, analyte: "x".repeat(41) })).toEqual(["analyte"]);
  });

  it("takes any material the teacher types (D9)", () => {
    expect(issuePaths({ ...FORM, material: "cerebrospinal fluid" })).toEqual([]);
  });
});

describe("createTestInput and updateTestInput (D9)", () => {
  it("reads an Afinion 2 test as its analyte only", () => {
    expect(createTestInput.parse({ ...FORM, calculatedBy: "team" })).toEqual({
      name: "HbA1c",
      unit: "%",
      material: "blood",
      source: { kind: "afinion", analyte: "HbA1c" },
    });
  });

  it("reads an Epoch 2 test as its calculator only (S4)", () => {
    expect(
      createTestInput.parse({ ...FORM, source: "epoch_upload", calculatedBy: "edulims" }).source,
    ).toEqual({ kind: "epoch_upload", calculatedBy: "edulims" });
  });

  it("reads an empty unit as no unit, never an empty string", () => {
    expect(createTestInput.parse({ ...FORM, unit: "  " }).unit).toBeNull();
    expect(createTestInput.parse(FORM).unit).toBe("%");
  });

  it("reads a test entered by hand without a setting (O8)", () => {
    expect(
      createTestInput.parse({ ...FORM, source: "manual", calculatedBy: "team" }).source,
    ).toEqual({ kind: "manual" });
  });

  it("refuses an unknown key, an unknown source and a missing setting", () => {
    expect(createTestInput.safeParse({ ...FORM, createdBy: "someone" }).success).toBe(false);
    expect(createTestInput.safeParse({ ...FORM, source: "usb" }).success).toBe(false);
    expect(createTestInput.safeParse({ ...FORM, analyte: "" }).success).toBe(false);
  });

  it("names the test of an edit by a UUID", () => {
    const testId = "01960000-0000-7000-8000-000000000001";
    expect(updateTestInput.parse({ testId, test: FORM }).testId).toBe(testId);
    expect(updateTestInput.safeParse({ testId: "1", test: FORM }).success).toBe(false);
    expect(testIdInput.safeParse({ testId: "1" }).success).toBe(false);
  });
});

describe("the list's search params", () => {
  it("falls back to defaults on unknown values", () => {
    expect(
      testListSearchSchema.parse({
        q: "  ",
        status: ["retired", "gone"],
        source: "afinion",
        sort: "colour",
        page: "0",
        size: "7",
      }),
    ).toEqual({
      q: undefined,
      status: ["retired"],
      source: ["afinion"],
      sort: undefined,
      dir: undefined,
      page: undefined,
      size: undefined,
    });
  });

  it("is strict at the server function", () => {
    expect(listTestsInput.safeParse({ status: ["gone"] }).success).toBe(false);
    expect(listTestsInput.safeParse({ extra: 1 }).success).toBe(false);
    expect(listTestsInput.parse({ q: "glu", size: 10 })).toEqual({ q: "glu", size: 10 });
  });
});
