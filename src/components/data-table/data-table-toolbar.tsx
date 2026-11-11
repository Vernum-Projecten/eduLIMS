// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useDebouncer } from "@tanstack/react-pacer";
import type { RowData } from "@tanstack/react-table";
import { SearchIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import type { DataTableColumn, DataTableInstance } from "@/components/data-table/features";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { m } from "@/i18n/messages";

// NOTE: no requirement governs this: our own design. Long enough to skip mid-word requests.
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The search input of a toolbar: it filters `column` while the user types, debounced with
 * TanStack Pacer; Enter applies it at once. A change from outside (Reset, the back button)
 * replaces the text, but never the text the user is still typing.
 */
function DataTableSearch<TData extends RowData>({
  column,
  label,
  maxLength,
}: Readonly<{ column: DataTableColumn<TData>; label: string; maxLength: number }>) {
  const id = useId();
  const applied =
    typeof column.getFilterValue() === "string" ? String(column.getFilterValue()) : "";
  const [text, setText] = useState(applied);
  const [seen, setSeen] = useState(applied);
  const debouncer = useDebouncer(
    (value: string) => {
      const trimmed = value.trim();
      setSeen(trimmed);
      column.setFilterValue(trimmed === "" ? undefined : trimmed);
    },
    { wait: SEARCH_DEBOUNCE_MS },
  );
  if (applied !== seen) {
    setSeen(applied);
    if (applied !== text.trim()) {
      debouncer.cancel();
      setText(applied);
    }
  }
  return (
    <InputGroup className="w-full sm:w-80">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <InputGroupInput
        id={id}
        type="search"
        value={text}
        placeholder={label}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          debouncer.maybeExecute(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") debouncer.flush();
        }}
      />
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * The toolbar of a data table (#58), the shadcn pattern in one row that wraps on narrow
 * screens: a search that filters while typing, the faceted filters (`children`), "Reset" while
 * anything is filtered, and "View" on the right.
 */
export function DataTableToolbar<TData extends RowData>({
  table,
  search,
  children,
}: Readonly<{
  table: DataTableInstance<TData>;
  search?: { columnId: string; label: string; maxLength: number };
  children?: ReactNode;
}>) {
  const searchColumn = search ? table.getColumn(search.columnId) : undefined;
  const filtered = table.state.columnFilters.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <search className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {search && searchColumn && (
          <DataTableSearch
            column={searchColumn}
            label={search.label}
            maxLength={search.maxLength}
          />
        )}
        {children}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={m.data_table_reset_label()}
            onClick={() => table.resetColumnFilters(true)}
          >
            {m.data_table_reset()}
            <XIcon aria-hidden="true" data-icon="inline-end" />
          </Button>
        )}
      </search>
      <DataTableViewOptions table={table} />
    </div>
  );
}
