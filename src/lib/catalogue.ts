// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the test catalogue (D9, S4, #266), shared by the server, the screens and the
// tests. No `@/` imports, so plain Node can load it like the other vocabulary modules.

declare const catalogueTestIdBrand: unique symbol;

/** The id of a test in the catalogue; never interchangeable with a simulation or a lab id. */
export type CatalogueTestId = string & { readonly [catalogueTestIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns `value` as a {@link CatalogueTestId} when it is a UUID in its text form, else `null`. */
export function parseCatalogueTestId(value: string): CatalogueTestId | null {
  return UUID.test(value) ? (value as CatalogueTestId) : null;
}

/** Where the measurements of a test come from (D9, O4). */
export const TEST_SOURCES = ["afinion", "epoch_upload", "manual"] as const;
export type TestSourceKind = (typeof TEST_SOURCES)[number];

/** Who calculates the concentration from an Epoch 2 plate (D9, S4). */
export const EPOCH_CALCULATORS = ["team", "edulims"] as const;
export type EpochCalculator = (typeof EPOCH_CALCULATORS)[number];

/**
 * The source of a test's measurements. An Afinion 2 test names the analyte the analyser sends in
 * OBX-3; an Epoch 2 test says who calculates the concentration; a test entered by hand (a result
 * calculated from other results included, O8) has neither.
 */
export type TestSource =
  | { kind: "afinion"; analyte: string }
  | { kind: "epoch_upload"; calculatedBy: EpochCalculator }
  | { kind: "manual" };

/** Whether a test is offered to new simulations, or retired from them. */
export const TEST_STATUSES = ["active", "retired"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

// NOTE: no requirement governs these bounds: our own design (#266), held by the CHECKs of
// migration 0016_test_catalogue, so the form refuses what the database would.
export const TEST_NAME_MAX = 80;
export const TEST_UNIT_MAX = 20;
export const TEST_MATERIAL_MAX = 40;
export const TEST_ANALYTE_MAX = 40;

/**
 * The characters an analyte name may not hold: the HL7 v2 delimiters the Afinion 2 declares in
 * MSH-1 and MSH-2, and the segment end, which OBX-3 can never carry as text.
 */
export const HL7_DELIMITERS = /[|^~\\&\r\n]/;

/** Returns `value` when it names a {@link TestSourceKind}, else `undefined`. */
export function parseTestSourceKind(value: unknown): TestSourceKind | undefined {
  return TEST_SOURCES.find((source) => source === value);
}

/** Returns `value` when it names an {@link EpochCalculator}, else `undefined`. */
export function parseEpochCalculator(value: unknown): EpochCalculator | undefined {
  return EPOCH_CALCULATORS.find((calculator) => calculator === value);
}

/**
 * Returns whether two sources are the same, so a change of an in-use test can be refused. The
 * Epoch 2 calculator is a setting of the source, not the source: D9 lets a teacher switch it.
 */
export function sameSource(a: TestSource, b: TestSource): boolean {
  switch (a.kind) {
    case "afinion":
      return b.kind === "afinion" && a.analyte === b.analyte;
    case "epoch_upload":
      return b.kind === "epoch_upload";
    case "manual":
      return b.kind === "manual";
    default: {
      const unknown: never = a;
      return unknown;
    }
  }
}
