// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useVirtualRows } from "@/components/virtual/use-virtual-rows";
import { cn } from "@/lib/utils";
import { ariaRowPosition } from "@/lib/virtual-rows";

/** Props of {@link VirtualList}. */
export interface VirtualListProps<T> {
  items: readonly T[];
  /** A stable, unique key per item (an id, never the index). */
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** The accessible name of the list. */
  label: string;
  /** Estimated row height in px; rows may be taller, they are measured. */
  estimateRowHeight?: number;
  /** Viewport height in px the server renders the first window for (match the CSS height). */
  initialViewportHeight?: number;
  /** Classes for the scroll viewport; give it a fixed or max height (`h-[60svh]`). */
  className?: string;
}

/**
 * A long list that renders only the rows in view (TanStack Virtual), as a labelled `list`
 * whose items carry `aria-setsize` and `aria-posinset`, so a screen reader announces "item 312
 * of 10,000" for a row while only a window of rows exists in the DOM (WCAG 1.3.1).
 *
 * One row at a time is in the tab order; arrow keys, Home, End, PageUp and PageDown move focus
 * (WCAG 2.1.1). Rows may differ in height; each is measured.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  label,
  estimateRowHeight = 56,
  initialViewportHeight = 480,
  className,
}: Readonly<VirtualListProps<T>>) {
  const rows = useVirtualRows({
    count: items.length,
    getRowKey: (index) => {
      const item = items[index];
      return item === undefined ? `missing-${index}` : getKey(item);
    },
    estimateRowHeight,
    initialViewportHeight,
  });

  return (
    <div
      ref={rows.scrollRef}
      className={cn("relative overflow-y-auto overscroll-contain rounded-lg border", className)}
    >
      <ul
        ref={rows.containerRef}
        aria-label={label}
        onKeyDown={rows.onKeyDown}
        className="relative m-0 w-full list-none p-0"
      >
        {rows.virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <li
              key={virtualItem.key}
              {...rows.getRowProps(virtualItem.index)}
              aria-setsize={items.length}
              aria-posinset={ariaRowPosition(virtualItem.index)}
              className={cn(
                "w-full border-b outline-none last:border-b-0 focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                rows.positioned && "absolute top-0 left-0",
              )}
            >
              {renderItem(item, virtualItem.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
