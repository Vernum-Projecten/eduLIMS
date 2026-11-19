// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * A number read from a numeric cell, in two forms that hold the same value.
 *
 * `value` is the IEEE 754 double the workbook stores (ECMA-376 Part 1, SpreadsheetML: a numeric
 * cell's `v` holds an `xsd:double`). `text` is the shortest plain decimal (no exponent) that reads
 * back to exactly that double, so `Number(text) === value` always holds: `0.042` for a cell that
 * holds `4.2000000000000003E-2`. Nothing is rounded.
 */
export interface CellNumber {
  readonly text: string;
  readonly value: number;
}

/** The lexical form of `xsd:double` without `INF` and `NaN`, which no well or header may hold. */
const DOUBLE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** Returns the decimal `x` in plain notation, from its shortest round-trip form. */
export function plainDecimal(x: number): string {
  const shortest = String(Object.is(x, -0) ? 0 : x);
  const exponential = /^(-?)([0-9])(?:\.([0-9]+))?e([+-][0-9]+)$/.exec(shortest);
  if (exponential === null) return shortest;
  const [, sign = "", first = "", rest = "", exponent = "0"] = exponential;
  const digits = first + rest;
  const point = 1 + Number(exponent);
  // NOTE: ECMA-262 Number::toString uses an exponent only below 1e-6 or from 1e21, so the point
  // is never inside the at most 17 significant digits.
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return `${sign}${digits}${"0".repeat(point - digits.length)}`;
}

/** Reads the text of a numeric cell, or returns `undefined` when it is not a finite number. */
export function readCellNumber(raw: string): CellNumber | undefined {
  if (!DOUBLE.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return { text: plainDecimal(value), value: Object.is(value, -0) ? 0 : value };
}
