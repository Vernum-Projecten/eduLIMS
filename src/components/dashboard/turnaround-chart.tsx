// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { barX, defineChart } from "@tanstack/charts";
import type { ChartPoint } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import { EduChart } from "@/components/charts/edu-chart";
import { m } from "@/i18n/messages";
import { chartSeriesColor } from "@/lib/charts/palette";
import type { ChartTableColumn } from "@/lib/charts/table";
import { formatDuration } from "@/lib/i18n/dashboard-labels";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/locale";

/** One bar: a lab and its median turnaround time (G-01). */
export interface TurnaroundBar {
  labId: string;
  name: string;
  medianMs: number;
  minutes: number;
}

const BAR_HEIGHT = 36;
const CHART_PADDING = 72;

const minutes = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

function definition(bars: readonly TurnaroundBar[]) {
  return defineChart({
    marks: [
      barX(bars, {
        id: "turnaround",
        x: "minutes",
        y: "name",
        key: "labId",
        fill: chartSeriesColor(0),
        inset: 4,
      }),
    ],
    scales: {
      x: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: m.dashboard_chart_axis(), ticks: { format: minutes } },
      },
      y: { scale: scaleBand },
    },
    margin: { left: 140 },
    tooltip: {
      use: tooltip,
      anchor: "point",
      content: (points: readonly ChartPoint<TurnaroundBar, number, string>[]) => {
        const bar = points[0]?.datum;
        if (!bar) return { rows: [] };
        return {
          title: bar.name,
          rows: [{ label: m.dashboard_col_median(), value: formatDuration(bar.medianMs) }],
        };
      },
    },
  });
}

function columns(): ChartTableColumn<TurnaroundBar>[] {
  return [
    { id: "name", header: m.dashboard_col_lab(), cell: (bar) => bar.name },
    {
      id: "median",
      header: m.dashboard_col_median(),
      cell: (bar) => formatDuration(bar.medianMs),
      numeric: true,
    },
  ];
}

/**
 * The one chart of the dashboard (owner 2026-11-20 on #271): the median turnaround time per lab
 * (G-01) as horizontal bars through {@link EduChart}, with its table view. One series, so no
 * legend; a lab without a release has no bar and is named in the text below.
 */
export function TurnaroundChart({ bars }: Readonly<{ bars: readonly TurnaroundBar[] }>) {
  const locale = getLocale();
  // The definition captures translated labels and formatters, so it follows the locale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is what the labels read.
  const chart = useMemo(() => definition(bars), [bars, locale]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is what the labels read.
  const tableColumns = useMemo(() => columns(), [locale]);
  return (
    <EduChart
      definition={chart}
      ariaLabel={m.dashboard_chart_label()}
      description={m.dashboard_chart_description()}
      height={bars.length * BAR_HEIGHT + CHART_PADDING}
      table={{
        caption: m.dashboard_chart_heading(),
        rows: bars,
        columns: tableColumns,
        rowKey: (bar) => bar.labId,
      }}
    />
  );
}
