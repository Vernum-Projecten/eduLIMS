// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The analytes the Afinion 2 reports, from its own documentation in docs/vendor/afinion/ (#393):
// the HL7 Connectivity Protocol v4.0, §4.1 (the OBX-3 names and OBX-6 units of examples 4.1.1 to
// 4.1.9), and the User Manual 1117346 Rev. A, "Regional settings menu" (the HbA1c, ACR and Lipid
// Panel units are settings of the analyser, with % , mg/mmol and mmol/L as their defaults). No
// `@/` imports, so plain Node loads it. Nothing here comes from a simulation (Q-PRIV-4).
import type { UcumCode } from "./ucum.ts";

/** The assay (test cartridge) an analyte comes from; its unit setting is the assay's. */
export type AfinionAssay = "hba1c" | "crp" | "acr" | "lipid_panel";

/** One analyte the Afinion 2 sends in OBX-3. */
export interface AfinionAnalyte {
  /** The name in OBX-3, exactly as the analyser sends it. */
  readonly analyte: string;
  readonly assay: AfinionAssay;
  /** The unit the documentation shows, or `null` for a ratio the analyser sends without one. */
  readonly unit: UcumCode | null;
  /**
   * Whether the analyser lets its unit be set (User Manual, "Regional settings menu": "Other
   * units are available" for HbA1c, ACR and the Lipid Panel). A fixed unit cannot change.
   */
  readonly unitConfigurable: boolean;
}

const analyte = <const N extends string>(
  name: N,
  assay: AfinionAssay,
  unit: UcumCode | null,
  unitConfigurable: boolean,
): AfinionAnalyte & { readonly analyte: N } => ({ analyte: name, assay, unit, unitConfigurable });

/** Every analyte the Afinion 2 documentation names, in the order of its examples. */
export const AFINION_ANALYTES = [
  analyte("CRP", "crp", "mg/L", false),
  analyte("ACR", "acr", "mg/mmol", true),
  analyte("Alb", "acr", "mg/L", true),
  analyte("Creat", "acr", "mg/dL", true),
  analyte("Chol", "lipid_panel", "mmol/L", true),
  analyte("LDL", "lipid_panel", "mmol/L", true),
  analyte("HDL", "lipid_panel", "mmol/L", true),
  analyte("Trig", "lipid_panel", "mmol/L", true),
  analyte("non-HDL", "lipid_panel", "mmol/L", true),
  analyte("Chol/HDL", "lipid_panel", null, false),
  analyte("HbA1c", "hba1c", "%", true),
] as const satisfies readonly AfinionAnalyte[];

/** An analyte name the Afinion 2 sends. */
export type AfinionAnalyteName = (typeof AFINION_ANALYTES)[number]["analyte"];

/** Returns the analyte the Afinion 2 sends as `name` (exact, as OBX-3 is), or `undefined`. */
export function afinionAnalyte(name: string): AfinionAnalyte | undefined {
  return AFINION_ANALYTES.find((entry) => entry.analyte === name);
}

/**
 * Returns whether `unit` (`null` for no unit) fits the analyte: exactly the documented unit when
 * it is fixed, and any unit when the analyser lets its unit be set.
 */
export function afinionUnitAllowed(entry: AfinionAnalyte, unit: string | null): boolean {
  return entry.unitConfigurable ? unit !== null : entry.unit === unit;
}
