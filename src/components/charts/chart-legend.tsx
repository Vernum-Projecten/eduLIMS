// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/** The symbol a series is drawn with, so it differs by shape as well as colour (SC 1.4.1). */
export type ChartSeriesShape = "circle" | "hexagon" | "ring" | "square";

/** One series in the legend. */
export interface ChartLegendItem {
  /** Stable id of the series. */
  id: string;
  /** The translated series name. */
  label: string;
  /** The 0-based palette index the chart paints this series with (`chartSeriesColor`). */
  colorIndex: number;
  shape: ChartSeriesShape;
}

/** Fill and stroke utilities per palette colour; written out so Tailwind sees every class. */
const PAINT = [
  "fill-chart-1 stroke-chart-1",
  "fill-chart-2 stroke-chart-2",
  "fill-chart-3 stroke-chart-3",
  "fill-chart-4 stroke-chart-4",
  "fill-chart-5 stroke-chart-5",
  "fill-chart-6 stroke-chart-6",
] as const;

function SeriesSymbol({
  shape,
  colorIndex,
}: Readonly<{ shape: ChartSeriesShape; colorIndex: number }>) {
  const paint = PAINT[colorIndex % PAINT.length];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4 shrink-0", paint)}>
      {shape === "circle" && <circle cx="8" cy="8" r="6" />}
      {shape === "ring" && <circle cx="8" cy="8" r="5.5" fillOpacity="0.2" strokeWidth="2" />}
      {shape === "hexagon" && <path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z" />}
      {shape === "square" && <rect x="2.5" y="2.5" width="11" height="11" />}
    </svg>
  );
}

/**
 * The chart's legend as HTML text: each series by name with the symbol and colour it is drawn
 * in, so a reader who cannot tell the colours apart still matches series by shape and label.
 */
export function ChartLegend({ items }: Readonly<{ items: readonly ChartLegendItem[] }>) {
  return (
    <ul aria-label={m.chart_legend()} className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5">
          <SeriesSymbol shape={item.shape} colorIndex={item.colorIndex} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
