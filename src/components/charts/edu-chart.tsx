// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ChartRenderContext, ChartValue } from "@tanstack/charts";
import { Chart, type ChartDefinition, type ChartPoint } from "@tanstack/charts/react";
import { TableIcon } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { ChartLegend, type ChartLegendItem } from "@/components/charts/chart-legend";
import { ChartTable, type ChartTableData } from "@/components/charts/chart-table";
import { Toggle } from "@/components/ui/toggle";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/** The props of {@link EduChart}. */
export interface EduChartProps<
  TDatum,
  TXValue extends ChartValue,
  TYValue extends ChartValue,
  TRow,
> {
  /** A TanStack Charts definition; memoize it when it captures component values. */
  definition: ChartDefinition<TDatum, TXValue, TYValue>;
  /** The translated accessible name of the chart: what it shows, in a few words. */
  ariaLabel: string;
  /** The translated description: how to read the chart, shown above it and linked with `aria-describedby`. */
  description: string;
  /** The same data as a table, for the "View as table" toggle. */
  table: ChartTableData<TRow>;
  /** The series by shape, colour and name; omit for a chart with one series. */
  legend?: readonly ChartLegendItem[];
  /** The chart height in CSS pixels, the same on the server and in the browser. */
  height: number;
  /** The width the server renders at before the browser measures the container. */
  initialWidth?: number;
  /** Called with the focused point (pointer or keyboard), carrying the original typed row. */
  onFocusChange?: (point: ChartPoint<TDatum, TXValue, TYValue> | null) => void;
  className?: string;
}

/**
 * The one way eduLIMS draws a chart: a TanStack Charts `Chart` (server-rendered SVG, adopted in
 * the browser) with a required accessible name, a visible description linked by
 * `aria-describedby`, an HTML legend by shape and name, and a "View as table" toggle that shows
 * the same rows as an accessible table (WCAG 2.1 SC 1.1.1, 1.3.1, 1.4.1). The series colours and
 * the tooltip chrome come from the theme tokens (`--chart-1` to `--chart-6`, `src/styles/app.css`)
 * for light and dark.
 */
export function EduChart<TDatum, TXValue extends ChartValue, TYValue extends ChartValue, TRow>({
  definition,
  ariaLabel,
  description,
  table,
  legend,
  height,
  initialWidth = 720,
  onFocusChange,
  className,
}: Readonly<EduChartProps<TDatum, TXValue, TYValue, TRow>>) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const tableId = `${id}-table`;
  const [showTable, setShowTable] = useState(false);

  // The adapter names the SVG; this links it to the visible description as well.
  const describe = useCallback(
    (context: ChartRenderContext<TDatum, TXValue, TYValue>) => {
      context.svg.setAttribute("aria-describedby", descriptionId);
    },
    [descriptionId],
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p id={descriptionId} className="max-w-prose text-sm text-muted-foreground text-pretty">
          {description}
        </p>
        <Toggle
          variant="outline"
          pressed={showTable}
          onPressedChange={setShowTable}
          aria-controls={tableId}
          className="shrink-0 self-start"
        >
          <TableIcon aria-hidden="true" />
          {m.chart_view_as_table()}
        </Toggle>
      </div>
      {legend && legend.length > 0 && <ChartLegend items={legend} />}
      <div hidden={showTable} className="min-w-0 text-foreground">
        <Chart
          definition={definition}
          ariaLabel={ariaLabel}
          ariaDescription={description}
          height={height}
          initialWidth={initialWidth}
          onRender={describe}
          {...(onFocusChange ? { onFocusChange } : {})}
        />
      </div>
      <div id={tableId} hidden={!showTable} className="min-w-0">
        {showTable && <ChartTable data={table} id={`${tableId}-data`} />}
      </div>
    </div>
  );
}
