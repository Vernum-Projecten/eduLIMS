// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  createDataTableColumnHelper,
  type DataTableInstance,
} from "@/components/data-table/features";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";

/**
 * Returns the selection column of a data table (#58): a labelled checkbox per selectable row
 * and one in the header that selects every selectable row of the page. A row the table's
 * `enableRowSelection` refuses gets no checkbox at all.
 */
export function selectionColumn<TData extends RowData>(rowLabel: (row: TData) => string) {
  const helper = createDataTableColumnHelper<TData>();
  return helper.display({
    id: "select",
    enableSorting: false,
    enableHiding: false,
    meta: { className: "w-10" },
    header: ({ table }) => (
      <Checkbox
        aria-label={m.data_table_select_page()}
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
        }
        disabled={!table.getRowModel().rows.some((row) => row.getCanSelect())}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
      />
    ),
    cell: ({ row }) =>
      row.getCanSelect() ? (
        <Checkbox
          aria-label={m.data_table_select_row({ name: rowLabel(row.original) })}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        />
      ) : null,
  });
}

/**
 * The bulk action bar of a data table (#58): while rows are selected it shows how many, the
 * actions (`children`) and "Clear selection". The count is announced through a live region
 * that stays in the page, so every change is read out.
 */
export function DataTableBulkBar<TData extends RowData>({
  table,
  children,
}: Readonly<{ table: DataTableInstance<TData>; children: ReactNode }>) {
  const count = table.getSelectedRowIds().length;
  const selected = m.data_table_selected({ count: formatNumber(count) });
  return (
    <>
      <p role="status" className="sr-only">
        {count > 0 ? selected : ""}
      </p>
      {count > 0 && (
        <section
          aria-label={m.data_table_bulk_actions()}
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2"
        >
          <span className="text-sm font-medium tabular-nums" aria-hidden="true">
            {selected}
          </span>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
          <Button
            variant="ghost"
            size="sm"
            className="sm:ml-auto"
            onClick={() => table.resetRowSelection(true)}
          >
            <XIcon aria-hidden="true" data-icon="inline-start" />
            {m.data_table_clear_selection()}
          </Button>
        </section>
      )}
    </>
  );
}
