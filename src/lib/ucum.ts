// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The units a test of the catalogue may have (D9, #393): a curated list of UCUM codes, the unit
// system openEHR uses for DV_QUANTITY.units. Codes follow The Unified Code for Units of Measure
// (https://ucum.org/ucum), case-sensitive form (c/s). No `@/` imports, so plain Node loads it.

/** How the list groups a unit, so the common laboratory units come first. */
export type UcumUnitKind = "common" | "other";

/** One supported unit: its UCUM code (stored), the symbol shown, and how the list groups it. */
export interface UcumUnit {
  /** The UCUM case-sensitive code, as stored and sent to FerroEHR. */
  readonly code: string;
  /** The printed symbol, where it differs from the code (`µmol/L` for `umol/L`). */
  readonly symbol: string;
  readonly kind: UcumUnitKind;
}

const unit = <const C extends string>(
  code: C,
  kind: UcumUnitKind,
  symbol: string = code,
): UcumUnit & { readonly code: C } => ({ code, symbol, kind });

/**
 * The supported units, the common laboratory units first. Every code is a valid UCUM c/s
 * expression: a prefix (`m`, `u`, `n`, `p`, `d`) on a base unit (`mol`, `g`, `L`), `%`, the
 * arbitrary unit `[IU]`, `U` (enzyme unit) or a power of ten (`10*9`). A ratio without a unit
 * stores no unit (`null`), which FerroEHR receives as UCUM's unity `1`.
 */
export const UCUM_UNITS = [
  unit("mmol/L", "common"),
  unit("umol/L", "common", "µmol/L"),
  unit("mg/L", "common"),
  unit("mg/dL", "common"),
  unit("g/L", "common"),
  unit("%", "common"),
  unit("mmol/mol", "common"),
  unit("mg/mmol", "common"),
  unit("mg/g", "common"),
  unit("U/L", "common"),
  unit("10*9/L", "common", "10⁹/L"),
  unit("nmol/L", "other"),
  unit("pmol/L", "other"),
  unit("g/dL", "other"),
  unit("ug/L", "other", "µg/L"),
  unit("ng/mL", "other"),
  unit("pg/mL", "other"),
  unit("[IU]/L", "other", "IU/L"),
  unit("m[IU]/L", "other", "mIU/L"),
  unit("10*12/L", "other", "10¹²/L"),
  unit("mosm/kg", "other"),
  unit("[pH]", "other", "pH"),
  unit("s", "other"),
] as const satisfies readonly UcumUnit[];

/** One unit of {@link UCUM_UNITS}. */
export type SupportedUcumUnit = (typeof UCUM_UNITS)[number];

/** A supported UCUM code. */
export type UcumCode = SupportedUcumUnit["code"];

/** The supported codes, in the order of the list. */
export const UCUM_CODES: readonly UcumCode[] = UCUM_UNITS.map((entry) => entry.code);

/** Returns whether `code` is a supported unit; the comparison is exact, as UCUM c/s is. */
export function isUcumCode(code: string): code is UcumCode {
  return UCUM_CODES.some((known) => known === code);
}

/** Returns the supported unit `code`, or `undefined` for a code outside the list. */
export function ucumUnit(code: string): SupportedUcumUnit | undefined {
  return UCUM_UNITS.find((entry) => entry.code === code);
}

/**
 * Returns the symbol every screen shows for a unit (`µmol/L` for the code `umol/L`; maintainer
 * 2026-11-20 on #404), never the raw code; a code outside the list shows as it is, and no unit
 * (`null`) shows as nothing.
 */
export function unitSymbol(code: string | null): string {
  if (code === null) return "";
  return ucumUnit(code)?.symbol ?? code;
}
