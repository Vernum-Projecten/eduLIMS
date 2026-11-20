// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The JSON value types of the canonical openEHR documents eduLIMS builds.

/** A JSON value. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
