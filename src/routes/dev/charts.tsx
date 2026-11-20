// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defineChart, dot, hexagon } from "@tanstack/charts";
import type { ChartPoint } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ChartLegendItem, ChartSeriesShape } from "@/components/charts/chart-legend";
import { EduChart } from "@/components/charts/edu-chart";
import { Page } from "@/components/shell/page-header";
import { PublicLayout } from "@/components/shell/public-layout";
import { m } from "@/i18n/messages";
import { chartSeriesColor } from "@/lib/charts/palette";
import { maxOf, sqrtRadiusScale } from "@/lib/charts/radius-scale";
import type { ChartTableColumn } from "@/lib/charts/table";
import { getDevPagesEnabled } from "@/lib/dev-tools.functions";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/locale";
import { DEMO_LABS, type DemoLab, type DemoSimulation, SIMULATIONS } from "./-labs-demo";

export const Route = createFileRoute("/dev/charts")({
  // Development pages are refused in production: the server answers, so a 404 is real.
  beforeLoad: async () => {
    if (!(await getDevPagesEnabled())) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.dev_charts_title()} · eduLIMS` }] }),
  component: DevCharts,
});

/** Each simulation differs by shape as well as by colour (WCAG 2.1 SC 1.4.1). */
const SIMULATION_SHAPE = { 1: "circle", 2: "hexagon", 3: "ring" } as const satisfies Record<
  DemoSimulation,
  ChartSeriesShape
>;

/** Point radius in CSS pixels for the lab with the fewest and the most requests. */
const RADIUS_RANGE = [4, 16] as const;

const simulationLabel = (simulation: DemoSimulation) =>
  m.dev_charts_simulation_value({ simulation: String(simulation) });
const minutes = (value: number) =>
  formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

function inSimulation(simulation: DemoSimulation) {
  return DEMO_LABS.filter((lab) => lab.simulation === simulation);
}

function scatterDefinition() {
  const radius = sqrtRadiusScale(maxOf(DEMO_LABS.map((lab) => lab.requests)) ?? 1, RADIUS_RANGE);
  const shared = {
    x: "released",
    y: "turnaround",
    r: "requests",
    rScale: radius,
    color: "simulation",
    key: "id",
  } as const;
  return defineChart({
    marks: [
      dot(inSimulation(1), {
        ...shared,
        id: "simulation-1",
        stroke: "var(--background)",
        strokeWidth: 1,
      }),
      hexagon(inSimulation(2), {
        ...shared,
        id: "simulation-2",
        stroke: "var(--background)",
        strokeWidth: 1,
      }),
      dot(inSimulation(3), {
        ...shared,
        id: "simulation-3",
        fillOpacity: 0.2,
        stroke: chartSeriesColor(2),
        strokeWidth: 2.5,
      }),
    ],
    scales: {
      x: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: m.dev_charts_released(), ticks: { format: whole } },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: m.dev_charts_turnaround(), ticks: { format: minutes } },
      },
    },
    color: {
      scale: scaleOrdinal<number, string>(
        SIMULATIONS,
        SIMULATIONS.map((_, index) => chartSeriesColor(index)),
      ),
    },
    // Keeps the largest points inside the plot.
    margin: { top: RADIUS_RANGE[1], right: RADIUS_RANGE[1] },
    tooltip: {
      use: tooltip,
      anchor: "point",
      content: (points: readonly ChartPoint<DemoLab, number, number>[]) => {
        const lab = points[0]?.datum;
        if (!lab) return { rows: [] };
        return {
          title: lab.name,
          rows: [
            { label: m.dev_charts_released(), value: whole(lab.released) },
            { label: m.dev_charts_turnaround(), value: minutes(lab.turnaround) },
            { label: m.dev_charts_requests(), value: whole(lab.requests) },
            { label: m.dev_charts_simulation(), value: simulationLabel(lab.simulation) },
          ],
        };
      },
    },
  });
}

function tableColumns(): ChartTableColumn<DemoLab>[] {
  return [
    { id: "name", header: m.dev_charts_lab(), cell: (row) => row.name },
    {
      id: "released",
      header: m.dev_charts_released(),
      cell: (row) => whole(row.released),
      numeric: true,
    },
    {
      id: "turnaround",
      header: m.dev_charts_turnaround(),
      cell: (row) => minutes(row.turnaround),
      numeric: true,
    },
    {
      id: "requests",
      header: m.dev_charts_requests(),
      cell: (row) => whole(row.requests),
      numeric: true,
    },
    {
      id: "simulation",
      header: m.dev_charts_simulation(),
      cell: (row) => simulationLabel(row.simulation),
    },
  ];
}

function focusText(lab: DemoLab | undefined): string {
  if (!lab) return m.dev_charts_focused_none();
  return m.dev_charts_focused({
    lab: lab.name,
    released: whole(lab.released),
    turnaround: minutes(lab.turnaround),
    requests: whole(lab.requests),
    simulation: String(lab.simulation),
  });
}

function DevCharts() {
  const { user } = Route.useRouteContext();
  const locale = getLocale();
  // The definition captures translated labels and formatters, so it follows the locale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is what the labels read.
  const definition = useMemo(() => scatterDefinition(), [locale]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is what the labels read.
  const columns = useMemo(() => tableColumns(), [locale]);
  const legend: ChartLegendItem[] = SIMULATIONS.map((simulation, index) => ({
    id: `simulation-${simulation}`,
    label: simulationLabel(simulation),
    colorIndex: index,
    shape: SIMULATION_SHAPE[simulation],
  }));
  const [focused, setFocused] = useState<DemoLab | undefined>();

  return (
    <PublicLayout signedIn={user !== null}>
      <Page title={m.dev_charts_title()} description={m.dev_charts_intro()}>
        <section aria-labelledby="scatter-heading" className="flex flex-col gap-4">
          <h2 id="scatter-heading" className="text-xl font-semibold tracking-tight">
            {m.dev_charts_scatter_heading()}
          </h2>
          <EduChart
            definition={definition}
            ariaLabel={m.dev_charts_scatter_label({ count: String(DEMO_LABS.length) })}
            description={m.dev_charts_scatter_description()}
            legend={legend}
            height={420}
            table={{
              caption: m.dev_charts_table_caption(),
              rows: DEMO_LABS,
              columns,
              rowKey: (row) => row.id,
            }}
            onFocusChange={(point) => setFocused(point?.datum)}
          />
          <p role="status" className="text-sm">
            {focusText(focused)}
          </p>
        </section>
      </Page>
    </PublicLayout>
  );
}
