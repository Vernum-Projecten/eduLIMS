// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the analyser register (B3, #35), shared by the server, the screens and the
// seed. No `@/` imports: `pnpm db:seed` loads this in plain Node.

/** How an analyser's results reach FerroEHR: HL7 v2 through FerroBRIDGE, or the Gen5 upload. */
export const ANALYSER_ROUTES = ["hl7_ferrobridge", "excel_upload"] as const;
export type AnalyserRoute = (typeof ANALYSER_ROUTES)[number];

/** Whether an analyser is in use, in maintenance, or retired from the register. */
export const ANALYSER_STATUSES = ["in_use", "maintenance", "retired"] as const;
export type AnalyserStatus = (typeof ANALYSER_STATUSES)[number];

/** The statuses the edit form offers; retiring is its own confirmed action. */
export const EDITABLE_ANALYSER_STATUSES = ["in_use", "maintenance"] as const;
export type EditableAnalyserStatus = (typeof EDITABLE_ANALYSER_STATUSES)[number];

// NOTE: no requirement governs this: our own design. The bounds match the CHECKs of migration
// 0009_analyser, so the form refuses what the database would.
export const ANALYSER_MODEL_MAX = 100;
export const ANALYSER_SERIAL_MAX = 64;
export const ANALYSER_LOCATION_MAX = 120;
export const ANALYSER_NOTES_MAX = 1000;

/** Returns `value` when it names an {@link AnalyserRoute}, else `undefined`. */
export function parseAnalyserRoute(value: unknown): AnalyserRoute | undefined {
  return ANALYSER_ROUTES.find((route) => route === value);
}

/** Returns `value` when it names an {@link AnalyserStatus}, else `undefined`. */
export function parseAnalyserStatus(value: unknown): AnalyserStatus | undefined {
  return ANALYSER_STATUSES.find((status) => status === value);
}
