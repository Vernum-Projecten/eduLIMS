// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A team's own tolerance (S13) and the one check a team gets before a release (S15, W7): is a
// value inside the lower and upper limit the team entered itself? The numbers stay decimal text
// and are compared digit by digit, never as binary floats. No `@/` imports.
import { compareDecimals, parseDecimal } from "./decimal.ts";

/** One tolerance of a lab for one test: canonical decimals, `lower` not above `upper` (S13). */
export interface Tolerance {
  lower: string;
  upper: string;
}

/** Where a value lies against a tolerance: inside it, or below or above it. */
export type ToleranceCheck = "inside" | "below" | "above";

/**
 * Returns where `value` lies against the team's own `tolerance` (S15). A value equal to a limit
 * is inside (S13). Compared as decimals, so "5.20" equals "5.2".
 *
 * @throws RangeError when `value` or a limit is not a decimal `parseDecimal` accepts.
 */
export function checkTolerance(value: string, tolerance: Tolerance): ToleranceCheck {
  if (compareDecimals(value, tolerance.lower) < 0) return "below";
  if (compareDecimals(value, tolerance.upper) > 0) return "above";
  return "inside";
}

/**
 * Returns where a measured value lies against the team's own tolerance (S15), or `null` when the
 * value or a limit is no decimal within the bounds (more than 9 digits before the point, more
 * than 6 after, or exponent form). Never throws, so an odd value from an analyser gives the
 * caller a refusal to show, never a server error.
 */
export function checkMeasuredValue(value: string, tolerance: Tolerance): ToleranceCheck | null {
  const parsed = parseDecimal(value);
  const lower = parseDecimal(tolerance.lower);
  const upper = parseDecimal(tolerance.upper);
  if (parsed === null || lower === null || upper === null) return null;
  return checkTolerance(parsed, { lower, upper });
}

/** Returns whether two tolerances hold the same limits, compared as decimals. */
export function sameTolerance(a: Tolerance, b: Tolerance): boolean {
  return compareDecimals(a.lower, b.lower) === 0 && compareDecimals(a.upper, b.upper) === 0;
}
