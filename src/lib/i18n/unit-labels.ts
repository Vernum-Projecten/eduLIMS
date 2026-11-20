// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated common names of the supported UCUM units (D9, #393).
import { m } from "@/i18n/messages";
import { UCUM_UNITS, type UcumCode, ucumUnit } from "@/lib/ucum";

/** Returns the common name of a supported unit, in the active language. */
export function ucumName(code: UcumCode): string {
  switch (code) {
    case "mmol/L":
      return m.unit_mmol_per_l();
    case "umol/L":
      return m.unit_umol_per_l();
    case "mg/L":
      return m.unit_mg_per_l();
    case "mg/dL":
      return m.unit_mg_per_dl();
    case "g/L":
      return m.unit_g_per_l();
    case "%":
      return m.unit_percent();
    case "mmol/mol":
      return m.unit_mmol_per_mol();
    case "mg/mmol":
      return m.unit_mg_per_mmol();
    case "mg/g":
      return m.unit_mg_per_g();
    case "U/L":
      return m.unit_u_per_l();
    case "10*9/L":
      return m.unit_giga_per_l();
    case "nmol/L":
      return m.unit_nmol_per_l();
    case "pmol/L":
      return m.unit_pmol_per_l();
    case "g/dL":
      return m.unit_g_per_dl();
    case "ug/L":
      return m.unit_ug_per_l();
    case "ng/mL":
      return m.unit_ng_per_ml();
    case "pg/mL":
      return m.unit_pg_per_ml();
    case "[IU]/L":
      return m.unit_iu_per_l();
    case "m[IU]/L":
      return m.unit_miu_per_l();
    case "10*12/L":
      return m.unit_tera_per_l();
    case "mosm/kg":
      return m.unit_mosm_per_kg();
    case "[pH]":
      return m.unit_ph();
    case "s":
      return m.unit_second();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/**
 * Returns a unit for the screen: its symbol with its common name ("mmol/L (millimole per
 * litre)"), the code as it is for a code outside the list, or "No unit" for `null`.
 */
export function unitLabel(code: string | null): string {
  if (code === null) return m.catalogue_no_unit();
  const entry = ucumUnit(code);
  if (entry === undefined) return code;
  return m.unit_label({ symbol: entry.symbol, name: ucumName(entry.code) });
}

/** One choice of the unit field: the code, its label, and the code as a search keyword. */
export interface UnitOption {
  readonly value: UcumCode;
  readonly label: string;
  readonly keywords: string;
}

/** Returns every supported unit as a choice, the common laboratory units first. */
export function unitOptions(): UnitOption[] {
  return UCUM_UNITS.map((entry) => ({
    value: entry.code,
    label: unitLabel(entry.code),
    keywords: entry.code,
  }));
}
