// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { nextRowIndex, rowsPerPage, withActiveRow } from "@/lib/virtual-rows";

/** Options of {@link useVirtualRows}. */
export interface VirtualRowsOptions {
  /** Number of rows in the whole set (not just the rendered window). */
  count: number;
  /** A stable key per row index, so React and the size cache follow the row, not the slot. */
  getRowKey: (index: number) => string;
  /** Estimated row height in px; real heights are measured after render. */
  estimateRowHeight: number;
  /** Height in px the server assumes for the viewport, so SSR renders the first window. */
  initialViewportHeight: number;
  /** Rows rendered beyond each edge of the viewport. */
  overscan?: number;
}

/**
 * Windowed rows over TanStack Virtual with a roving tab stop and the APG keyboard model: arrow
 * keys, Home, End, PageUp and PageDown move focus and scroll the focused row into view.
 *
 * Positions are written by the virtualizer itself (`directDomUpdates`), so markup carries no
 * inline style. Until the first client layout effect (`positioned` false) rows are laid out in
 * normal flow, which is where the first window sits anyway: the server HTML and the hydration
 * render match. The active row is always rendered, so DOM focus survives scrolling it away.
 *
 * @see https://tanstack.com/virtual/latest/docs/api/virtualizer
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/grid/ (keyboard interaction)
 */
export function useVirtualRows({
  count,
  getRowKey,
  estimateRowHeight,
  initialViewportHeight,
  overscan = 5,
}: VirtualRowsOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [positioned, setPositioned] = useState(false);
  // Set by keyboard moves only, so a mouse click or a re-render never steals focus.
  const pendingFocus = useRef<number | null>(null);

  const rangeExtractor = useCallback(
    (range: Range) => withActiveRow(defaultRangeExtractor(range), activeIndex),
    [activeIndex],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    getItemKey: getRowKey,
    overscan,
    rangeExtractor,
    initialRect: { width: 0, height: initialViewportHeight },
    directDomUpdates: true,
  });

  useLayoutEffect(() => setPositioned(true), []);

  const focusRow = useCallback((index: number) => {
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    row?.focus({ preventScroll: true });
    return row !== null && row !== undefined;
  }, []);

  const virtualItems = virtualizer.getVirtualItems();
  // The one tab stop: the active row, else the first rendered one (never an unmounted row).
  const tabStop =
    activeIndex !== null && activeIndex < count ? activeIndex : (virtualItems[0]?.index ?? 0);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null || virtualItems.length === 0) return;
    if (focusRow(target)) pendingFocus.current = null;
  }, [virtualItems, focusRow]);

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      pendingFocus.current = index;
      virtualizer.scrollToIndex(index, { align: "auto" });
      focusRow(index);
    },
    [virtualizer, focusRow],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const viewport = scrollRef.current?.clientHeight ?? initialViewportHeight;
      const next = nextRowIndex(
        event.key,
        activeIndex,
        count,
        rowsPerPage(viewport, estimateRowHeight),
      );
      if (next === null) return;
      event.preventDefault();
      moveTo(next);
    },
    [activeIndex, count, estimateRowHeight, initialViewportHeight, moveTo],
  );

  /** Props for the row element at `index`: measurement, roving tab stop and focus tracking. */
  const getRowProps = (index: number) => ({
    ref: virtualizer.measureElement,
    "data-index": index,
    tabIndex: index === tabStop ? 0 : -1,
    onFocus: () => setActiveIndex(index),
  });

  return {
    scrollRef,
    containerRef: virtualizer.containerRef,
    virtualizer,
    virtualItems,
    positioned,
    activeIndex,
    getRowProps,
    onKeyDown,
  };
}
