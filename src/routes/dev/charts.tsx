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
import {
  ACADEMIC_YEARS,
  type AcademicYear,
  DEMO_PRACTICALS,
  type DemoPractical,
} from "./-practicals-demo";

export const Route = createFileRoute("/dev/charts")({
  // Development pages are refused in production: the server answers, so a 404 is real.
  beforeLoad: async () => {
    if (!(await getDevPagesEnabled())) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.dev_charts_title()} · eduLIMS` }] }),
  component: DevCharts,
});

/** Each academic year differs by shape as well as by colour (WCAG 2.1 SC 1.4.1). */
const YEAR_SHAPE = { 1: "circle", 2: "hexagon", 3: "ring" } as const satisfies Record<
  AcademicYear,
  ChartSeriesShape
>;

/** Point radius in CSS pixels for the smallest and the largest class. */
const RADIUS_RANGE = [4, 16] as const;

const yearLabel = (year: AcademicYear) => m.dev_charts_year({ year: String(year) });
const grade = (value: number) =>
  formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

function inYear(year: AcademicYear) {
  return DEMO_PRACTICALS.filter((practical) => practical.academicYear === year);
}

function scatterDefinition() {
  const radius = sqrtRadiusScale(
    maxOf(DEMO_PRACTICALS.map((practical) => practical.classSize)) ?? 1,
    RADIUS_RANGE,
  );
  const shared = {
    x: "submissions",
    y: "averageGrade",
    r: "classSize",
    rScale: radius,
    color: "academicYear",
    key: "id",
  } as const;
  return defineChart({
    marks: [
      dot(inYear(1), { ...shared, id: "year-1", stroke: "var(--background)", strokeWidth: 1 }),
      hexagon(inYear(2), { ...shared, id: "year-2", stroke: "var(--background)", strokeWidth: 1 }),
      dot(inYear(3), {
        ...shared,
        id: "year-3",
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
        axis: { label: m.dev_charts_submissions(), ticks: { format: whole } },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: m.dev_charts_average_grade(), ticks: { format: grade } },
      },
    },
    color: {
      scale: scaleOrdinal<number, string>(
        ACADEMIC_YEARS,
        ACADEMIC_YEARS.map((_, index) => chartSeriesColor(index)),
      ),
    },
    // Keeps the largest points inside the plot.
    margin: { top: RADIUS_RANGE[1], right: RADIUS_RANGE[1] },
    tooltip: {
      use: tooltip,
      anchor: "point",
      content: (points: readonly ChartPoint<DemoPractical, number, number>[]) => {
        const practical = points[0]?.datum;
        if (!practical) return { rows: [] };
        return {
          title: practical.title,
          rows: [
            { label: m.dev_charts_submissions(), value: whole(practical.submissions) },
            { label: m.dev_charts_average_grade(), value: grade(practical.averageGrade) },
            { label: m.dev_charts_class_size(), value: whole(practical.classSize) },
            { label: m.dev_charts_academic_year(), value: yearLabel(practical.academicYear) },
          ],
        };
      },
    },
  });
}

function tableColumns(): ChartTableColumn<DemoPractical>[] {
  return [
    { id: "title", header: m.dev_charts_practical(), cell: (row) => row.title },
    {
      id: "submissions",
      header: m.dev_charts_submissions(),
      cell: (row) => whole(row.submissions),
      numeric: true,
    },
    {
      id: "averageGrade",
      header: m.dev_charts_average_grade(),
      cell: (row) => grade(row.averageGrade),
      numeric: true,
    },
    {
      id: "classSize",
      header: m.dev_charts_class_size(),
      cell: (row) => whole(row.classSize),
      numeric: true,
    },
    {
      id: "academicYear",
      header: m.dev_charts_academic_year(),
      cell: (row) => yearLabel(row.academicYear),
    },
  ];
}

function focusText(practical: DemoPractical | undefined): string {
  if (!practical) return m.dev_charts_focused_none();
  return m.dev_charts_focused({
    practical: practical.title,
    submissions: whole(practical.submissions),
    grade: grade(practical.averageGrade),
    size: whole(practical.classSize),
    year: String(practical.academicYear),
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
  const legend: ChartLegendItem[] = ACADEMIC_YEARS.map((year, index) => ({
    id: `year-${year}`,
    label: yearLabel(year),
    colorIndex: index,
    shape: YEAR_SHAPE[year],
  }));
  const [focused, setFocused] = useState<DemoPractical | undefined>();

  return (
    <PublicLayout signedIn={user !== null}>
      <Page title={m.dev_charts_title()} description={m.dev_charts_intro()}>
        <section aria-labelledby="scatter-heading" className="flex flex-col gap-4">
          <h2 id="scatter-heading" className="text-xl font-semibold tracking-tight">
            {m.dev_charts_scatter_heading()}
          </h2>
          <EduChart
            definition={definition}
            ariaLabel={m.dev_charts_scatter_label({ count: String(DEMO_PRACTICALS.length) })}
            description={m.dev_charts_scatter_description()}
            legend={legend}
            height={420}
            table={{
              caption: m.dev_charts_table_caption(),
              rows: DEMO_PRACTICALS,
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
