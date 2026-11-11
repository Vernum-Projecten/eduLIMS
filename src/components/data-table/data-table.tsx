// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import { type ReactNode, useId } from "react";
import {
  DataTableVirtualBody,
  type DataTableVirtualOptions,
} from "@/components/data-table/data-table-virtual-body";
import type { DataTableInstance } from "@/components/data-table/features";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

function ariaSort(sorted: false | "asc" | "desc") {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return undefined;
}

// NOTE: no requirement governs this: our own design. The container scrolls both ways, so the
// header sticks inside it and a wide table scrolls within it instead of the page (WCAG 1.4.10).
const SCROLL_CONTAINER =
  "relative max-h-[70vh] overflow-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot=table-container]]:overflow-visible";

/**
 * A data table (#58): the shadcn `Table` rendered from a TanStack Table v9 instance, with a
 * caption, `aria-sort` on the sorted header, a sticky header, and `empty` in place of the rows
 * when there are none. The container is a labelled, focusable region so the keyboard can
 * scroll it. While `busy` (the next page or filter is loading over the previous one), the
 * table is marked busy and a translated "Updating…" shows over its corner, without moving
 * anything.
 *
 * With `virtual`, a long list that is not paginated renders only the rows in view
 * ({@link DataTableVirtualBody}); a server-paginated table leaves it out.
 */
export function DataTable<TData extends RowData>({
  table,
  caption,
  empty,
  busy = false,
  virtual,
}: Readonly<{
  table: DataTableInstance<TData>;
  caption: string;
  empty: ReactNode;
  busy?: boolean;
  virtual?: DataTableVirtualOptions;
}>) {
  const captionId = useId();
  if (virtual !== undefined) {
    return (
      <DataTableVirtualBody
        table={table}
        caption={caption}
        empty={empty}
        busy={busy}
        options={virtual}
      />
    );
  }
  const rows = table.getRowModel().rows;
  const columnCount = table.getVisibleLeafColumns().length;
  return (
    <div className="relative">
      <UpdatingIndicator active={busy} />
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1). */}
      <section aria-labelledby={captionId} tabIndex={0} className={SCROLL_CONTAINER}>
        <Table aria-busy={busy || undefined} className={cn(busy && "opacity-70")}>
          <TableCaption id={captionId} className="sr-only">
            {caption}
          </TableCaption>
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={ariaSort(header.column.getIsSorted())}
                    className={header.column.columnDef.meta?.className}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="p-0 whitespace-normal">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className="data-[state=selected]:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn("align-top", cell.column.columnDef.meta?.className)}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

/** The loading state of a data table: a toolbar line and skeleton rows, announced as loading. */
export function DataTableSkeleton({ rows = 8 }: Readonly<{ rows?: number }>) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only" role="status">
        {m.loading()}
      </span>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full max-w-xs" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-2">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity.
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
