// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DataTableInstance } from "@/components/data-table/features";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVirtualRows } from "@/components/virtual/use-virtual-rows";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { ariaRowPosition } from "@/lib/virtual-rows";

/** How a {@link DataTable} renders its rows virtually: only the rows in view are in the DOM. */
export interface DataTableVirtualOptions {
  /** Estimated row height in px; rows may be taller, each is measured. */
  estimateRowHeight?: number;
  /** Height in px of the scroll viewport; match the height class, so SSR renders one window. */
  viewportHeight?: number;
  /** Classes for the scroll viewport; give it the height of `viewportHeight` (`h-[480px]`). */
  className?: string;
}

/** The header height the server assumes before the browser measures it: `h-10` of `TableHead`. */
const HEADER_HEIGHT = 40;

// A virtual row is absolutely positioned, so it cannot share the table's column layout. Every
// row is a flex row instead, and each cell takes an equal share (`flex-1`) unless its column
// meta sets a width (`w-32 flex-none`). Header and body cells get the same classes, so the
// columns line up whichever rows are rendered (WCAG 1.3.1 keeps the table roles explicit).
const CELL_WIDTH = "min-w-24 flex-1";

function ariaSort(sorted: false | "asc" | "desc") {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return undefined;
}

/**
 * The virtual form of {@link DataTable} (#76), for a long list that is not paginated: TanStack
 * Virtual renders the rows in view plus an overscan, inside a scroll viewport whose header
 * stays sticky. The table carries `aria-rowcount` and every rendered row its `aria-rowindex`,
 * so a screen reader hears "row 312 of 10,001" for a window of rows (WCAG 1.3.1).
 *
 * One row is the tab stop; arrow keys, Home, End, PageUp and PageDown move focus over all rows
 * (the `useVirtualRows` keyboard model, WCAG 2.1.1), and the focused row stays rendered.
 */
export function DataTableVirtualBody<TData extends RowData>({
  table,
  caption,
  empty,
  busy,
  options,
}: Readonly<{
  table: DataTableInstance<TData>;
  caption: string;
  empty: ReactNode;
  busy: boolean;
  options: DataTableVirtualOptions;
}>) {
  const captionId = useId();
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const [headerHeight, setHeaderHeight] = useState(HEADER_HEIGHT);
  const rows = table.getRowModel().rows;
  const headerGroups = table.getHeaderGroups();
  const headerRows = headerGroups.length;
  const viewportHeight = options.viewportHeight ?? 480;

  const virtual = useVirtualRows({
    count: rows.length,
    getRowKey: (index) => rows[index]?.id ?? `missing-${index}`,
    estimateRowHeight: options.estimateRowHeight ?? 41,
    initialViewportHeight: viewportHeight,
    scrollMargin: headerHeight,
  });

  // The header grows with the text size and wraps on a narrow screen; the window starts below it.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (header === null) return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Only a key on a row itself moves between rows; a control inside a cell keeps its keys.
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.target instanceof HTMLTableRowElement) virtual.onKeyDown(event);
  };

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1.5 right-2 z-20 flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground shadow-sm",
          !busy && "invisible",
        )}
      >
        {busy && <Spinner className="size-3" />}
        {m.data_table_updating()}
      </span>
      <section
        ref={virtual.scrollRef}
        aria-labelledby={captionId}
        className={cn(
          "relative h-[480px] max-h-[70vh] overflow-auto overscroll-contain rounded-lg border [&>[data-slot=table-container]]:overflow-visible",
          options.className,
        )}
      >
        <Table
          role="table"
          aria-labelledby={captionId}
          aria-rowcount={rows.length === 0 ? undefined : rows.length + headerRows}
          aria-busy={busy || undefined}
          className={cn("block min-w-min", busy && "opacity-70")}
        >
          <TableCaption id={captionId} className="sr-only">
            {caption}
          </TableCaption>
          <TableHeader
            ref={headerRef}
            role="rowgroup"
            className="sticky top-0 z-10 block bg-background shadow-[inset_0_-1px_0_var(--color-border)]"
          >
            {headerGroups.map((group, groupIndex) => (
              <TableRow
                key={group.id}
                role="row"
                aria-rowindex={groupIndex + 1}
                className="flex w-full border-b-0 hover:bg-transparent"
              >
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    role="columnheader"
                    scope="col"
                    aria-sort={ariaSort(header.column.getIsSorted())}
                    className={cn(
                      "flex items-center",
                      CELL_WIDTH,
                      header.column.columnDef.meta?.className,
                    )}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            ref={virtual.containerRef}
            role="rowgroup"
            onKeyDown={onKeyDown}
            className="relative block"
          >
            {rows.length === 0 ? (
              <TableRow role="row" className="flex w-full hover:bg-transparent">
                <TableCell role="cell" className="w-full p-0 whitespace-normal">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              virtual.virtualItems.map((item) => {
                const row = rows[item.index];
                if (row === undefined) return null;
                return (
                  <TableRow
                    key={item.key}
                    {...virtual.getRowProps(item.index)}
                    role="row"
                    aria-rowindex={ariaRowPosition(item.index, headerRows)}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={cn(
                      "flex w-full outline-none focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset data-[state=selected]:bg-muted/40",
                      virtual.positioned && "absolute top-0 left-0",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        role="cell"
                        className={cn(
                          "flex items-start break-words whitespace-normal",
                          CELL_WIDTH,
                          cell.column.columnDef.meta?.className,
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
