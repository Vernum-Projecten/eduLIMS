// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The analytes the demo rows cycle through (Afinion 2 HbA1c and CRP, Epoch 2 absorbance). */
export const DEMO_ANALYTES = ["hba1c", "crp", "absorbance"] as const;

/** One fictional measurement row of the `/dev/virtual` demo; no person, only a sample ID. */
export interface DemoRow {
  /** Stable key and visible sample ID, `VD-00001` upward. */
  id: string;
  analyte: (typeof DEMO_ANALYTES)[number];
  /** Value in the analyte's unit, two decimals. */
  value: number;
  inRange: boolean;
  /** Every ninth row carries a note, so rows differ in height. */
  hasNote: boolean;
}

/**
 * Returns `count` deterministic fictional rows: the same input always gives the same rows, so
 * the server render and the hydration render agree and tests can name a row.
 */
export function demoRows(count: number): DemoRow[] {
  return Array.from({ length: count }, (_, index) => {
    const analyte = DEMO_ANALYTES[index % DEMO_ANALYTES.length] ?? "hba1c";
    // A fixed integer hash spreads values without randomness.
    const spread = ((index * 7919) % 1000) / 1000;
    const value = Math.round((analyte === "absorbance" ? spread * 2 : 4 + spread * 6) * 100) / 100;
    return {
      id: `VD-${String(index + 1).padStart(5, "0")}`,
      analyte,
      value,
      inRange: (index * 31) % 10 !== 0,
      hasNote: index % 9 === 4,
    };
  });
}

/** The columns the `/dev/virtual-table` demo sorts by. */
export const DEMO_SORT_COLUMNS = ["id", "value", "status"] as const;

/** One of {@link DEMO_SORT_COLUMNS}. */
export type DemoSortColumn = (typeof DEMO_SORT_COLUMNS)[number];

/** Tells whether a column id is one the demo sorts by. */
export function isDemoSortColumn(id: string): id is DemoSortColumn {
  return (DEMO_SORT_COLUMNS as readonly string[]).includes(id);
}

function compareBy(column: DemoSortColumn, a: DemoRow, b: DemoRow): number {
  switch (column) {
    case "id":
      return a.id.localeCompare(b.id);
    case "value":
      return a.value - b.value;
    case "status":
      // Ascending puts the rows in range first.
      return Number(!a.inRange) - Number(!b.inRange);
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}

/**
 * Returns the rows sorted by the first entry of `sorting` (TanStack Table's `SortingState`
 * shape), ties broken by sample ID so the order is the same on every visit. An empty sort or
 * an unknown column keeps the input order. The input array is not changed.
 */
export function sortDemoRows(
  rows: readonly DemoRow[],
  sorting: readonly { id: string; desc: boolean }[],
): DemoRow[] {
  const sort = sorting[0];
  if (sort === undefined || !isDemoSortColumn(sort.id)) return [...rows];
  const column = sort.id;
  const direction = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => direction * compareBy(column, a, b) || a.id.localeCompare(b.id));
}
