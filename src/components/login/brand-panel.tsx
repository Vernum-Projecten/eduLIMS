// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/lib/utils";

// A full 96-well plate (8 rows by 12 columns) on the brand's 6-unit well pitch, the pattern the
// Microplate mark is a corner of (assets/brand/README.md).
const PITCH = 6;
const COLUMNS = Array.from({ length: 12 }, (_, index) => 8 + index * PITCH);
const ROWS = Array.from({ length: 8 }, (_, index) => 8 + index * PITCH);
const SAMPLE = { column: 8, row: 3 } as const;

/**
 * The decorative brand panel of the login page: the 96-well plate, outlined, on the indigo tile
 * colour. Hidden from assistive technology; it carries no information.
 */
export function BrandPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex items-center justify-center bg-brand-tile p-8 lg:p-16", className)}
    >
      <svg
        viewBox="-4 -4 90 66"
        aria-hidden="true"
        focusable="false"
        className="h-auto max-h-40 w-full max-w-2xl lg:max-h-none"
      >
        <rect
          x="1"
          y="1"
          width="80"
          height="56"
          rx="5"
          strokeWidth="0.75"
          className="fill-none stroke-brand-well"
        />
        <g className="fill-brand-well">
          {ROWS.flatMap((cy, row) =>
            COLUMNS.map((cx, column) =>
              row === SAMPLE.row && column === SAMPLE.column ? null : (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />
              ),
            ),
          )}
        </g>
        <circle
          cx={COLUMNS[SAMPLE.column]}
          cy={ROWS[SAMPLE.row]}
          r="2.6"
          className="fill-brand-sample"
        />
      </svg>
    </div>
  );
}
