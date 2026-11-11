// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from "lucide-react";
import { columnLabel, type DataTableColumn } from "@/components/data-table/features";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";

/**
 * A column header (#58): the column name, and for a column that sorts or hides, a menu with
 * "Ascending", "Descending" and "Hide column". The header cell carries `aria-sort`.
 */
export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
}: Readonly<{ column: DataTableColumn<TData, TValue> }>) {
  const title = columnLabel(column);
  const canSort = column.getCanSort();
  const canHide = column.getCanHide();
  if (!canSort && !canHide) return <span>{title}</span>;
  const sorted = canSort ? column.getIsSorted() : false;
  const Icon =
    sorted === "desc" ? ArrowDownIcon : sorted === "asc" ? ArrowUpIcon : ChevronsUpDownIcon;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2.5 data-[state=open]:bg-accent">
          {title}
          {canSort && <Icon aria-hidden="true" data-icon="inline-end" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {canSort && (
          <>
            <DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
              <ArrowUpIcon aria-hidden="true" />
              {m.data_table_sort_asc()}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
              <ArrowDownIcon aria-hidden="true" />
              {m.data_table_sort_desc()}
            </DropdownMenuItem>
          </>
        )}
        {canSort && canHide && <DropdownMenuSeparator />}
        {canHide && (
          <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
            <EyeOffIcon aria-hidden="true" />
            {m.data_table_hide_column()}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
