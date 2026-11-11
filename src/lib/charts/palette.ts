// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The number of categorical series colours the theme defines (`--chart-1` to `--chart-6`). */
export const CHART_PALETTE_SIZE = 6;

/**
 * Returns the paint for the categorical series at `index` (0-based): a CSS variable the theme
 * sets for light and dark (`src/styles/app.css`), so a chart follows the theme without a new
 * definition. Indices past the palette wrap around; a chart with more series than colours must
 * tell them apart by shape or label as well (WCAG 2.1 SC 1.4.1).
 *
 * @throws RangeError when `index` is not a nonnegative integer.
 */
export function chartSeriesColor(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`series index must be a nonnegative integer: ${String(index)}`);
  }
  return `var(--ts-chart-${(index % CHART_PALETTE_SIZE) + 1})`;
}
