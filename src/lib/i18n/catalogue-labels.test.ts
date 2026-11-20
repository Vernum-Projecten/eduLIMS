// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isAfinionAnalyte, lockedTestFields, sameSource } from "@/lib/catalogue";
import {
  catalogueErrorMessage,
  testSourceDetail,
  testSourceLabel,
  testStatusLabel,
  testUsageLabel,
} from "./catalogue-labels";

describe("test catalogue labels (D9, #266)", () => {
  it("names every source and status", () => {
    expect(testSourceLabel("afinion")).toBe("Afinion 2");
    expect(testSourceLabel("epoch_upload")).toBe("Epoch 2 upload");
    expect(testSourceLabel("manual")).toBe("Entry by hand");
    expect(testStatusLabel("active")).toBe("Active");
    expect(testStatusLabel("retired")).toBe("Retired");
  });

  it("names how simulations use a test, and nothing for an unused one (#267)", () => {
    expect(testUsageLabel("unused")).toBeNull();
    expect(testUsageLabel("used")).toBe("Used by a simulation");
    expect(testUsageLabel("running")).toBe("In a running simulation");
  });

  it("puts a source's setting in words", () => {
    expect(testSourceDetail({ kind: "afinion", analyte: "CRP" })).toBe("Analyte CRP");
    expect(testSourceDetail({ kind: "epoch_upload", calculatedBy: "team" })).toBe(
      "The lab calculates",
    );
    expect(testSourceDetail({ kind: "epoch_upload", calculatedBy: "edulims" })).toBe(
      "eduLIMS calculates",
    );
    expect(testSourceDetail({ kind: "manual" })).toBeNull();
  });

  it("names every refusal, and anything else as a failure", () => {
    for (const code of [
      "not_found",
      "name_taken",
      "retired",
      "not_retired",
      "in_use",
      "in_running_simulation",
      "analyte_taken",
    ]) {
      expect(catalogueErrorMessage(code)).not.toBe(catalogueErrorMessage("failed"));
    }
    expect(catalogueErrorMessage("anything")).toBe("The change could not be saved. Try again.");
  });
});

describe("sameSource (D9)", () => {
  it("treats the Epoch 2 calculator as a setting, and the analyte as part of the source", () => {
    expect(
      sameSource(
        { kind: "epoch_upload", calculatedBy: "team" },
        { kind: "epoch_upload", calculatedBy: "edulims" },
      ),
    ).toBe(true);
    expect(
      sameSource({ kind: "afinion", analyte: "CRP" }, { kind: "afinion", analyte: "CRP" }),
    ).toBe(true);
    expect(
      sameSource({ kind: "afinion", analyte: "CRP" }, { kind: "afinion", analyte: "hsCRP" }),
    ).toBe(false);
    expect(sameSource({ kind: "manual" }, { kind: "afinion", analyte: "CRP" })).toBe(false);
    expect(sameSource({ kind: "manual" }, { kind: "manual" })).toBe(true);
  });
});

describe("lockedTestFields (D9; maintainer 2026-11-19)", () => {
  it("fixes nothing, then the unit, source and analyte, then the material and calculator too", () => {
    expect([...lockedTestFields("unused")]).toEqual([]);
    expect([...lockedTestFields("used")]).toEqual(["unit", "source", "analyte"]);
    expect([...lockedTestFields("running")]).toEqual([
      "unit",
      "source",
      "analyte",
      "material",
      "calculatedBy",
    ]);
  });
});

describe("isAfinionAnalyte (security review F3)", () => {
  it("takes printable ASCII without the HL7 delimiters only", () => {
    for (const analyte of ["CRP", "HbA1c", "Chol/HDL", "non-HDL", "A B"]) {
      expect(isAfinionAnalyte(analyte), analyte).toBe(true);
    }
    for (const analyte of ["CR|P", "A^B", "A~B", "A\\B", "A&B", "Créat", "A\tB", ""]) {
      expect(isAfinionAnalyte(analyte), analyte).toBe(false);
    }
  });
});
