// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The smallest and largest radius in pixels a radius scale draws. */
export type RadiusRange = readonly [min: number, max: number];

/**
 * Returns a square-root radius scale for a point mark's `rScale`: the domain `[0, max]` maps to
 * `range`, with the radius growing with the square root of the value, as D3's `scaleSqrt` does.
 * With `range[0]` at 0 the point's area is proportional to the value; a positive minimum keeps
 * the smallest value visible and focusable. A value above `max` is clamped to `range[1]`.
 *
 * @throws RangeError when `max` is not a finite number above zero, or `range` is not two finite
 *   nonnegative numbers in ascending order.
 */
export function sqrtRadiusScale(max: number, range: RadiusRange): (value: number) => number {
  const [low, high] = range;
  if (!Number.isFinite(max) || max <= 0) {
    throw new RangeError(`radius scale maximum must be above zero: ${String(max)}`);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) {
    throw new RangeError(`radius range must be ascending and nonnegative: [${low}, ${high}]`);
  }
  const root = Math.sqrt(max);
  return (value) => {
    const share = Math.min(Math.sqrt(Math.max(value, 0)) / root, 1);
    return low + (high - low) * share;
  };
}

/** Returns the largest finite value in `values`, or `undefined` when there is none. */
export function maxOf(values: Iterable<number>): number | undefined {
  let max: number | undefined;
  for (const value of values) {
    if (Number.isFinite(value) && (max === undefined || value > max)) max = value;
  }
  return max;
}
