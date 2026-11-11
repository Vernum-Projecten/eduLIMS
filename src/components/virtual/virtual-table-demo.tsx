// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type SortingState, useTable } from "@tanstack/react-table";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import { Page } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  ANALYTE_LABEL,
  ANALYTE_UNIT,
  DEMO_ROW_COUNT,
} from "@/components/virtual/virtual-list-demo";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { type DemoRow, demoRows, sortDemoRows } from "@/lib/virtual-demo-rows";

const helper = createDataTableColumnHelper<DemoRow>();

const columns = helper.columns([
  helper.accessor("id", {
    id: "id",
    meta: { label: () => m.dev_virtual_table_col_sample(), className: "w-36 flex-none" },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.id}</span>,
  }),
  helper.accessor("analyte", {
    id: "analyte",
    meta: { label: () => m.dev_virtual_table_col_analyte(), className: "min-w-40" },
    enableSorting: false,
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => ANALYTE_LABEL[row.original.analyte](),
  }),
  helper.accessor("value", {
    id: "value",
    meta: { label: () => m.dev_virtual_table_col_value(), className: "w-36 flex-none" },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatNumber(row.original.value)} {ANALYTE_UNIT[row.original.analyte]}
      </span>
    ),
  }),
  helper.accessor("inRange", {
    id: "status",
    meta: { label: () => m.dev_virtual_table_col_status(), className: "min-w-40" },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) =>
      row.original.inRange ? (
        <Badge variant="secondary">
          <CircleCheckIcon aria-hidden="true" data-icon="inline-start" />
          {m.dev_virtual_in_range()}
        </Badge>
      ) : (
        <Badge variant="outline">
          <CircleAlertIcon
            aria-hidden="true"
            data-icon="inline-start"
            className="text-destructive"
          />
          {m.dev_virtual_out_of_range()}
        </Badge>
      ),
  }),
]);

/**
 * The `/dev/virtual-table` page body (#76): 10,000 deterministic fictional rows in a
 * {@link DataTable} with `virtual`, sortable by sample ID, value and status in the browser.
 */
export function VirtualTableDemo() {
  const allRows = useMemo(() => demoRows(DEMO_ROW_COUNT), []);
  const [sorting, setSorting] = useState<SortingState>([]);
  const data = useMemo(() => sortDemoRows(allRows, sorting), [allRows, sorting]);
  // The rows are sorted above, so the table renders them as given (no client row model).
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    rowCount: data.length,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <Page
      title={m.dev_virtual_table_title()}
      description={m.dev_virtual_table_intro({ count: formatNumber(DEMO_ROW_COUNT) })}
    >
      <DataTable
        table={table}
        caption={m.dev_virtual_table_caption({ count: formatNumber(DEMO_ROW_COUNT) })}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.dev_virtual_table_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
        virtual={{ estimateRowHeight: 37, viewportHeight: 480, className: "h-[480px]" }}
      />
    </Page>
  );
}
