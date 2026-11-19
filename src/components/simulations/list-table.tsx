// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type ColumnDef, type RowData, useTable } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { type DataTableFeatures, dataTableFeatures } from "@/components/data-table/features";

/**
 * A short list on the shared data table (#58) that the server returns whole and in its own
 * stable order (a simulation's labs, a lab's members): no sorting, filtering or pages, so the
 * rows show as the server ordered them. `columns` and `data` must be stable: module-scope columns, rows from the query cache.
 */
export function ListTable<TData extends RowData>({
  columns,
  data,
  rowId,
  caption,
  empty,
  busy,
}: Readonly<{
  columns: ColumnDef<DataTableFeatures, TData, unknown>[];
  data: TData[];
  rowId: (row: TData) => string;
  caption: string;
  empty: ReactNode;
  busy: boolean;
}>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    rowCount: data.length,
    getRowId: rowId,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
    state: { pagination: { pageIndex: 0, pageSize: Math.max(1, data.length) } },
  });
  return <DataTable table={table} caption={caption} empty={empty} busy={busy} />;
}
