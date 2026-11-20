// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements and the released result of a requested test (S14, S15): the branded id, where a
// measurement came from, and the state a requested test is in. No `@/` imports.

declare const measurementIdBrand: unique symbol;

/** The id of one measurement; never interchangeable with a sample or a request id. */
export type MeasurementId = string & { readonly [measurementIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns `value` as a {@link MeasurementId} when it is a UUID in its text form, else `null`. */
export function parseMeasurementId(value: string): MeasurementId | null {
  return UUID.test(value) ? (value as MeasurementId) : null;
}

/** Where a measurement came from, the same names as a catalogue test's source (D9). */
export const MEASUREMENT_SOURCES = ["afinion", "epoch_upload", "manual"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/** Returns `value` when it names a {@link MeasurementSource}, else `undefined`. */
export function parseMeasurementSource(value: unknown): MeasurementSource | undefined {
  return MEASUREMENT_SOURCES.find((source) => source === value);
}

/**
 * Where a released result stands in the patient's record in FerroEHR (#148): `written`, `pending`
 * while eduLIMS retries the write, or `none` for a control request, which has no patient (S16).
 */
export type PatientRecordState = "written" | "pending" | "none";

/** The state of a requested test (`docs/lims-workflow.md`, "The states of a requested test"). */
export type RequestedTestState = "requested" | "measured" | "released";

/** Returns the state of a requested test from its number of measurements and its release. */
export function requestedTestState(measurements: number, released: boolean): RequestedTestState {
  if (released) return "released";
  return measurements > 0 ? "measured" : "requested";
}
