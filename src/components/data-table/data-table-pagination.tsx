// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import type { DataTableInstance } from "@/components/data-table/features";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";

/** The first and last row of the page and the total, for the range text. */
export interface PageRange {
  first: string;
  last: string;
  total: string;
}

function PageButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: Readonly<{ icon: LucideIcon; label: string; disabled: boolean; onClick: () => void }>) {
  return (
    <Button variant="outline" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon aria-hidden="true" />
    </Button>
  );
}

/**
 * The pagination of a data table (#58): the rows shown, rows per page, "Page X of Y", and the
 * first, previous, next and last page as labelled icon buttons. The page count comes from the
 * server's `rowCount`.
 */
export function DataTablePagination<TData extends RowData>({
  table,
  label,
  pageSizes,
  range = (r) => m.data_table_range(r),
}: Readonly<{
  table: DataTableInstance<TData>;
  label: string;
  pageSizes: readonly number[];
  range?: (range: PageRange) => string;
}>) {
  const sizeId = useId();
  const { pageIndex, pageSize } = table.state.pagination;
  const total = table.getRowCount();
  const pages = Math.max(1, table.getPageCount());
  const first = total === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground">
        {range({
          first: formatNumber(first),
          last: formatNumber(last),
          total: formatNumber(total),
        })}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span id={sizeId} className="text-sm font-medium whitespace-nowrap">
            {m.data_table_rows_per_page()}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-20" aria-labelledby={sizeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {formatNumber(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm font-medium tabular-nums whitespace-nowrap">
          {m.data_table_page_of({
            page: formatNumber(pageIndex + 1),
            pages: formatNumber(pages),
          })}
        </span>
        <div className="flex items-center gap-2">
          <PageButton
            icon={ChevronsLeftIcon}
            label={m.data_table_page_first()}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
          />
          <PageButton
            icon={ChevronLeftIcon}
            label={m.data_table_page_previous()}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          />
          <PageButton
            icon={ChevronRightIcon}
            label={m.data_table_page_next()}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          />
          <PageButton
            icon={ChevronsRightIcon}
            label={m.data_table_page_last()}
            disabled={!table.getCanLastPage()}
            onClick={() => table.lastPage()}
          />
        </div>
      </div>
    </nav>
  );
}
