// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon, HistoryIcon } from "lucide-react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { ListTable } from "@/components/simulations/list-table";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatDateTime, formatDecimal } from "@/lib/i18n/format";
import type { ToleranceChange } from "@/server/tolerances/queries";
import { labTolerancesQueryOptions } from "@/server/tolerances/query-options";

const HEADING = "lab-tolerances-heading";

const helper = createDataTableColumnHelper<ToleranceChange>();

const testColumn = helper.accessor("testName", {
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
});

const limitColumns = [
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
];

const currentColumns = helper.columns([testColumn, ...limitColumns]);

const changeColumns = helper.columns([
  testColumn,
  ...limitColumns,
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

/** The links between the pages of changes; the page itself is in the URL (`changes`). */
function ChangesPager({ page, pages }: Readonly<{ page: number; pages: number }>) {
  if (pages < 2) return null;
  return (
    <nav aria-label={m.tolerances_changes_pages()} className="flex items-center gap-2">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link to="." search={(prev) => ({ ...prev, changes: page - 1 })} resetScroll={false}>
            <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
            {m.tolerances_changes_previous()}
          </Link>
        </Button>
      ) : null}
      <span className="text-muted-foreground text-sm">
        {m.tolerances_changes_page({ page: String(page), pages: String(pages) })}
      </span>
      {page < pages ? (
        <Button asChild variant="outline" size="sm">
          <Link to="." search={(prev) => ({ ...prev, changes: page + 1 })} resetScroll={false}>
            {m.tolerances_changes_next()}
            <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}

/**
 * A lab's tolerances on its teacher page (S13): the tolerance in force per test, then every
 * change, newest first, 50 to a page, each marked in force or replaced with an icon and text
 * (WCAG 1.4.1). The previous page stays on screen while another one loads.
 */
export function LabTolerancesSection({
  simulationId,
  labId,
  labName,
  changesPage,
}: Readonly<{ simulationId: string; labId: string; labName: string; changesPage: number }>) {
  const { data, isFetching } = useQuery({
    ...labTolerancesQueryOptions(simulationId, labId, changesPage),
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  if (data === undefined) return null;
  const { current, changes } = data;
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} className="text-lg font-semibold">
          {m.tolerances_teacher_heading()}
        </h2>
        <p className="text-muted-foreground">{m.tolerances_teacher_description()}</p>
      </div>
      <h3 className="font-medium">{m.tolerances_current_heading()}</h3>
      <ListTable
        columns={currentColumns}
        data={current}
        rowId={(row) => row.id}
        caption={m.tolerances_current_caption({ lab: labName })}
        busy={isFetching}
        empty={m.tolerances_teacher_empty()}
      />
      <h3 className="font-medium">{m.tolerances_changes_heading()}</h3>
      <div className="relative flex flex-col gap-3" aria-busy={isFetching}>
        <UpdatingIndicator active={isFetching} />
        <ListTable
          columns={changeColumns}
          data={changes.rows}
          rowId={(row) => row.id}
          caption={m.tolerances_changes_caption({
            lab: labName,
            page: String(changes.page),
            pages: String(changes.pages),
          })}
          busy={isFetching}
          empty={m.tolerances_teacher_empty()}
        />
        <ChangesPager page={changes.page} pages={changes.pages} />
      </div>
    </section>
  );
}
