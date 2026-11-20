// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The analytes the Afinion 2 reports (#393), checked against the HL7 fixture that follows the
// protocol's examples (§4.1), so the list and the messages agree.
import { describe, expect, it } from "vitest";
import { AFINION_ANALYTES, afinionAnalyte, afinionUnitAllowed } from "@/lib/afinion";
import { isAfinionAnalyte } from "@/lib/catalogue";
import { isUcumCode } from "@/lib/ucum";
import { AFINION_ASSAYS } from "../fixtures/hl7/afinion-oru.ts";

function entry(name: string) {
  const found = afinionAnalyte(name);
  if (found === undefined) throw new Error(`no analyte ${name}`);
  return found;
}

describe("the Afinion 2 analytes (#393)", () => {
  it("names every analyte the protocol's examples send, and no other", () => {
    const sent = Object.values(AFINION_ASSAYS).flatMap((assay) => assay.map((a) => a.name));
    expect(AFINION_ANALYTES.map((a) => a.analyte).sort()).toEqual([...sent].sort());
  });

  it("gives each analyte a unit the examples show, or none for the ratio", () => {
    for (const assay of Object.values(AFINION_ASSAYS)) {
      for (const sent of assay) {
        const known = entry(sent.name);
        // NOTE: User Manual, Regional settings; ACR defaults to mg/mmol, example 4.1.2 sends mg/g.
        if (sent.name === "ACR") expect(known.unit).toBe("mg/mmol");
        else expect(known.unit ?? "", sent.name).toBe(sent.unit);
      }
    }
  });

  it("uses supported UCUM units and names the analyser can send", () => {
    for (const analyte of AFINION_ANALYTES) {
      if (analyte.unit !== null) expect(isUcumCode(analyte.unit), analyte.analyte).toBe(true);
      expect(isAfinionAnalyte(analyte.analyte), analyte.analyte).toBe(true);
    }
  });

  it("matches an analyte name exactly, as OBX-3 is compared", () => {
    expect(afinionAnalyte("HbA1c")?.analyte).toBe("HbA1c");
    expect(afinionAnalyte("hba1c")).toBeUndefined();
    expect(afinionAnalyte("Glucose")).toBeUndefined();
  });

  it("holds a fixed unit to exactly that unit", () => {
    expect(afinionUnitAllowed(entry("CRP"), "mg/L")).toBe(true);
    expect(afinionUnitAllowed(entry("CRP"), "mg/dL")).toBe(false);
    expect(afinionUnitAllowed(entry("CRP"), null)).toBe(false);
    expect(afinionUnitAllowed(entry("Chol/HDL"), null)).toBe(true);
    expect(afinionUnitAllowed(entry("Chol/HDL"), "%")).toBe(false);
  });

  it("lets the HbA1c, ACR and Lipid Panel units change, never to none", () => {
    expect(afinionUnitAllowed(entry("HbA1c"), "mmol/mol")).toBe(true);
    expect(afinionUnitAllowed(entry("ACR"), "mg/g")).toBe(true);
    expect(afinionUnitAllowed(entry("Chol"), "mg/dL")).toBe(true);
    expect(afinionUnitAllowed(entry("HbA1c"), null)).toBe(false);
  });
});
