// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/lib/utils";

const COLUMNS = [10.5, 19.5, 28.5, 37.5] as const;
const ROWS = [15, 24, 33] as const;
const SAMPLE = { cx: 28.5, cy: 24 } as const;
const WELLS = ROWS.flatMap((cy) => COLUMNS.map((cx) => ({ cx, cy }))).filter(
  (well) => well.cx !== SAMPLE.cx || well.cy !== SAMPLE.cy,
);

/**
 * The eduLIMS mark (assets/brand/edulims-icon.svg) inline, so it takes the theme tokens.
 * Decorative: it always sits next to the visible name, which gives the accessible name.
 */
export function BrandMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cn("size-7", className)}
    >
      <rect width="48" height="48" rx="10.5" className="fill-brand-tile" />
      <rect
        x="0.75"
        y="0.75"
        width="46.5"
        height="46.5"
        rx="9.75"
        strokeWidth="1.5"
        className="hidden fill-none stroke-brand-rim dark:block"
      />
      <g className="fill-brand-well">
        {WELLS.map((well) => (
          <circle key={`${well.cx}-${well.cy}`} cx={well.cx} cy={well.cy} r="3" />
        ))}
      </g>
      <circle cx={SAMPLE.cx} cy={SAMPLE.cy} r="3.9" className="fill-brand-sample" />
    </svg>
  );
}
