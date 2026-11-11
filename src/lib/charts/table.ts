// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * One column of a chart's table view: its header and how a row reads in it. The text is what a
 * reader sees, so `cell` formats through the i18n layer (`@/lib/i18n/format`).
 */
export interface ChartTableColumn<TRow> {
  /** Stable id, unique within the table. */
  id: string;
  /** The translated column header. */
  header: string;
  /** The translated, formatted text of `row` in this column. */
  cell: (row: TRow) => string;
  /** Right-aligns a numeric column so digits line up. */
  numeric?: boolean;
}

/** One rendered cell of the table view. */
export interface ChartTableCell {
  columnId: string;
  text: string;
  /** The first column heads its row (`<th scope="row">`), so each value reads with its row. */
  rowHeader: boolean;
  numeric: boolean;
}

/** One rendered row of the table view. */
export interface ChartTableRow {
  key: string;
  cells: readonly ChartTableCell[];
}

/**
 * Maps the rows a chart draws to the rows of its table view, in the same order, so the table
 * shows exactly the values the chart encodes (WCAG 2.1 SC 1.1.1, 1.3.1).
 *
 * @throws Error when two rows share a key or two columns share an id, since each must identify
 *   one row or column of the table.
 */
export function chartTableRows<TRow>(
  rows: readonly TRow[],
  columns: readonly ChartTableColumn<TRow>[],
  rowKey: (row: TRow) => string,
): ChartTableRow[] {
  const columnIds = new Set<string>();
  for (const column of columns) {
    if (columnIds.has(column.id)) throw new Error(`duplicate chart table column: ${column.id}`);
    columnIds.add(column.id);
  }
  const keys = new Set<string>();
  return rows.map((row) => {
    const key = rowKey(row);
    if (keys.has(key)) throw new Error(`duplicate chart table row key: ${key}`);
    keys.add(key);
    return {
      key,
      cells: columns.map((column, index) => ({
        columnId: column.id,
        text: column.cell(row),
        rowHeader: index === 0,
        numeric: column.numeric ?? false,
      })),
    };
  });
}
