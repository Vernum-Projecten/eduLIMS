// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Pure index math for virtualised lists and tables (src/components/virtual/), kept free of
// React and the DOM so the keyboard model and the ARIA positions test without a browser.

/** The keys that move the active row of a virtualised list (WAI-ARIA APG grid and listbox keys). */
export const ROW_NAVIGATION_KEYS = [
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "PageDown",
  "PageUp",
] as const;

/** One of {@link ROW_NAVIGATION_KEYS}. */
export type RowNavigationKey = (typeof ROW_NAVIGATION_KEYS)[number];

/** Tells whether a `KeyboardEvent.key` moves the active row. */
export function isRowNavigationKey(key: string): key is RowNavigationKey {
  return (ROW_NAVIGATION_KEYS as readonly string[]).includes(key);
}

/** Clamps a row index into `[0, count - 1]`; `count` must be at least 1. */
export function clampRowIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Returns the row index a navigation key moves to, or `null` when the key does not navigate
 * or the list is empty.
 *
 * @param current - the active row index, or `null` when no row is active yet (the first key
 *   then lands on the first row, except End, which lands on the last).
 * @param pageSize - how many rows PageUp and PageDown move; at least 1.
 */
export function nextRowIndex(
  key: string,
  current: number | null,
  count: number,
  pageSize: number,
): number | null {
  if (count < 1 || !isRowNavigationKey(key)) return null;
  const page = Math.max(1, Math.floor(pageSize));
  const from = current === null ? null : clampRowIndex(current, count);
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return from === null ? 0 : clampRowIndex(from + 1, count);
    case "ArrowUp":
      return from === null ? 0 : clampRowIndex(from - 1, count);
    case "PageDown":
      return from === null ? 0 : clampRowIndex(from + page, count);
    case "PageUp":
      return from === null ? 0 : clampRowIndex(from - page, count);
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

/** Returns how many rows fit in a viewport: the PageUp and PageDown step, at least 1. */
export function rowsPerPage(viewportSize: number, rowSize: number): number {
  if (!(viewportSize > 0) || !(rowSize > 0)) return 1;
  return Math.max(1, Math.floor(viewportSize / rowSize));
}

/**
 * Returns the 1-based ARIA position of a row (`aria-posinset`, or `aria-rowindex` when
 * `headerRows` rows precede the body, as the header row of a table does).
 *
 * @see https://www.w3.org/TR/wai-aria-1.2/#aria-rowindex
 */
export function ariaRowPosition(index: number, headerRows = 0): number {
  return index + 1 + headerRows;
}

/**
 * Returns the rendered row indexes with the active row added, sorted, so the focused row stays
 * in the DOM (and keeps DOM focus) while it is scrolled out of the window.
 */
export function withActiveRow(indexes: readonly number[], active: number | null): number[] {
  if (active === null || indexes.includes(active)) return [...indexes];
  return [...indexes, active].sort((a, b) => a - b);
}
