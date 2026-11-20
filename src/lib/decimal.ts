// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Decimal numbers as text (D10, D13): a correct value and an accuracy limit stay the digits the
// teacher typed, from the form through PostgreSQL's `numeric` and back, and are compared digit by
// digit, never as binary floating point. No `@/` imports, so plain Node can load it.

/** The most digits before the decimal point (our own design, held by the database CHECKs). */
export const DECIMAL_INTEGER_DIGITS = 9;
/** The most digits after the decimal point (our own design, held by the database CHECKs). */
export const DECIMAL_FRACTION_DIGITS = 6;

const DECIMAL = new RegExp(
  `^([+-]?)(\\d{1,${DECIMAL_INTEGER_DIGITS}})(?:[.,](\\d{1,${DECIMAL_FRACTION_DIGITS}}))?$`,
);

/**
 * Returns `input` as a canonical decimal string (an optional `-`, digits, and a `.` with the
 * fraction as typed), or `null` when it is no decimal within the bounds. A comma is read as the
 * decimal separator, so "5,2" and "5.2" are the same value; there are no thousands separators.
 * Leading zeros go, and a minus zero is zero.
 */
export function parseDecimal(input: string): string | null {
  const match = DECIMAL.exec(input.trim());
  if (!match) return null;
  const [, sign = "", whole = "0", fraction] = match;
  const integer = whole.replace(/^0+(?=\d)/, "");
  const text = fraction === undefined ? integer : `${integer}.${fraction}`;
  const zero = /^[0.]+$/.test(text);
  return sign === "-" && !zero ? `-${text}` : text;
}

/** Returns a canonical decimal as an integer count of millionths, exact for every bound value. */
function scaled(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole) * 10n ** BigInt(DECIMAL_FRACTION_DIGITS);
  const parts = BigInt(fraction.padEnd(DECIMAL_FRACTION_DIGITS, "0") || "0");
  return negative ? -(units + parts) : units + parts;
}

/**
 * Returns a decimal given as text as an integer count of millionths, exact for every value
 * {@link parseDecimal} accepts ("5.2" is 5_200_000n).
 *
 * @throws RangeError when `value` is not a decimal {@link parseDecimal} accepts.
 */
export function decimalMillionths(value: string): bigint {
  const parsed = parseDecimal(value);
  if (parsed === null) throw new RangeError("not a decimal");
  return scaled(parsed);
}

/**
 * Compares two decimals given as text: negative when `a < b`, zero when equal ("5.20" equals
 * "5.2"), positive when `a > b`.
 *
 * @throws RangeError when either is not a decimal {@link parseDecimal} accepts.
 */
export function compareDecimals(a: string, b: string): number {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (left === null || right === null) throw new RangeError("not a decimal");
  const difference = scaled(left) - scaled(right);
  if (difference === 0n) return 0;
  return difference < 0n ? -1 : 1;
}

/** Returns whether a canonical decimal is below zero. */
export function isNegativeDecimal(value: string): boolean {
  return compareDecimals(value, "0") < 0;
}
