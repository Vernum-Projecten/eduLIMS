// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab number of a sample (S12, R-11; maintainer, 2026-11-19 on #268): ten decimal digits, the
// last a check digit by the Damm algorithm, which catches every single wrong digit and every swap
// of two neighbours. The team types it as the patient ID on the Afinion 2, whose field takes 16
// characters. Pure functions, so the form, the page and the server share one rule.

/** The number of digits of a lab number, the check digit included. */
export const LAB_NUMBER_LENGTH = 10;

/** The Damm quasigroup of order 10 (H. M. Damm, 2004), as the database function uses it. */
const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

const DIGITS = /^[0-9]+$/;

/** Returns the interim digit of the Damm algorithm over `digits`, which holds digits only. */
function interim(digits: string): number {
  let state = 0;
  for (const char of digits) {
    const row = DAMM[state];
    const next = row?.[char.charCodeAt(0) - 48];
    if (next === undefined) throw new RangeError("not a digit");
    state = next;
  }
  return state;
}

/**
 * Returns the Damm check digit of `digits`.
 *
 * @throws RangeError when `digits` is empty or holds anything but the digits 0 to 9.
 */
export function dammCheckDigit(digits: string): number {
  if (!DIGITS.test(digits)) throw new RangeError("not a digit string");
  return interim(digits);
}

/** Returns whether `value` is a lab number: ten digits whose Damm check comes out at zero. */
export function isLabNumber(value: string): boolean {
  return value.length === LAB_NUMBER_LENGTH && DIGITS.test(value) && interim(value) === 0;
}

/**
 * Returns a lab number from its nine leading digits by appending the check digit.
 *
 * @throws RangeError unless `body` is nine digits.
 */
export function withCheckDigit(body: string): string {
  if (body.length !== LAB_NUMBER_LENGTH - 1 || !DIGITS.test(body)) {
    throw new RangeError("a lab number body is nine digits");
  }
  return `${body}${dammCheckDigit(body)}`;
}

/**
 * Returns a lab number in groups of three, three and four digits ("123 456 7890"), so a team
 * reads it aloud and checks it on the analyser in short pieces. The copy action copies the
 * digits without spaces.
 */
export function formatLabNumber(value: string): string {
  return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
}

/**
 * Returns a lab number with a space between every digit ("1 2 3 4 5 6 7 8 9 0"), so a screen
 * reader reads it digit by digit instead of as one large number.
 */
export function spellLabNumber(value: string): string {
  return [...value].join(" ");
}
