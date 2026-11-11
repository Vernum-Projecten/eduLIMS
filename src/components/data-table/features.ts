// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Table v9 features every eduLIMS data table registers (#58). The data stays on
// the server: a table sets `manualSorting`, `manualFiltering` and `manualPagination` with the
// server's `rowCount`, so no client row model is registered.
import {
  type Column,
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  type ReactTable,
  type RowData,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

/** What a column tells the data-table components about itself. */
export interface DataTableColumnMeta {
  /** The translated column name, for its header, the View menu and the caption. */
  label?: () => string;
  /** Extra classes of the column's header and body cells. */
  className?: string;
}

/** The features of every data table: sorting, filtering, pagination, visibility, selection. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  rowSelectionFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/** A data table instance over rows of `TData`. */
export type DataTableInstance<TData extends RowData> = ReactTable<DataTableFeatures, TData>;

/** One column of a data table over rows of `TData` with values of `TValue`. */
export type DataTableColumn<TData extends RowData, TValue = unknown> = Column<
  DataTableFeatures,
  TData,
  TValue
>;

/** Returns the column helper of a data table over rows of `TData`. */
export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

/** Returns the translated name of a column, or its id when it has none. */
export function columnLabel<TData extends RowData, TValue>(
  column: DataTableColumn<TData, TValue>,
): string {
  return column.columnDef.meta?.label?.() ?? column.id;
}
