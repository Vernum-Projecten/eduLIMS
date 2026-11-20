// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { CircleCheckIcon, HistoryIcon } from "lucide-react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { ListTable } from "@/components/simulations/list-table";
import { m } from "@/i18n/messages";
import { formatDateTime, formatDecimal } from "@/lib/i18n/format";
import type { ToleranceChange } from "@/server/tolerances/queries";
import { labTolerancesQueryOptions } from "@/server/tolerances/query-options";

const HEADING = "lab-tolerances-heading";

const helper = createDataTableColumnHelper<ToleranceChange>();

const columns = helper.columns([
  helper.accessor("testName", {
    id: "test",
    header: () => m.tolerances_col_test(),
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium break-words">{row.original.testName}</span>
        {row.original.unit ? (
          <span className="text-muted-foreground text-sm">{row.original.unit}</span>
        ) : null}
      </span>
    ),
  }),
  helper.display({
    id: "lower",
    header: () => m.tolerances_col_lower(),
    cell: ({ row }) => <span className="tabular-nums">{formatDecimal(row.original.lower)}</span>,
  }),
  helper.display({
    id: "upper",
    header: () => m.tolerances_col_upper(),
    cell: ({ row }) => <span className="tabular-nums">{formatDecimal(row.original.upper)}</span>,
  }),
  helper.display({
    id: "setAt",
    header: () => m.tolerances_col_set_at(),
    cell: ({ row }) => (
      <time dateTime={row.original.setAt}>{formatDateTime(row.original.setAt)}</time>
    ),
  }),
  helper.display({
    id: "status",
    header: () => m.tolerances_col_status(),
    cell: ({ row }) =>
      row.original.current ? (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
          {m.tolerances_status_current()}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
          {m.tolerances_status_replaced()}
        </span>
      ),
  }),
]);

/**
 * A lab's tolerances on its teacher page (S13): every tolerance the lab set, per test with the
 * newest first, each marked in force or replaced with an icon and text (WCAG 1.4.1).
 */
export function LabTolerancesSection({
  simulationId,
  labId,
  labName,
}: Readonly<{ simulationId: string; labId: string; labName: string }>) {
  const { data: changes, isFetching } = useSuspenseQuery(
    labTolerancesQueryOptions(simulationId, labId),
  );
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} className="text-lg font-semibold">
          {m.tolerances_teacher_heading()}
        </h2>
        <p className="text-muted-foreground">{m.tolerances_teacher_description()}</p>
      </div>
      <ListTable
        columns={columns}
        data={changes}
        rowId={(row) => row.id}
        caption={m.tolerances_teacher_caption({ lab: labName })}
        busy={isFetching}
        empty={m.tolerances_teacher_empty()}
      />
    </section>
  );
}
