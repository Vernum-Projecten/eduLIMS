// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The rows of a 96-well plate, top to bottom. */
export const PLATE_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/** The columns of a 96-well plate, left to right. */
export const PLATE_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** A row of a 96-well plate. */
export type PlateRow = (typeof PLATE_ROWS)[number];

/** A column of a 96-well plate. */
export type PlateColumn = (typeof PLATE_COLUMNS)[number];

/** A well of a 96-well plate by its row letter and column number, such as `A1` or `H12`. */
export type WellId = `${PlateRow}${PlateColumn}`;

/** Returns the id of the well at `row` and `column`. */
export function wellId(row: PlateRow, column: PlateColumn): WellId {
  return `${row}${column}`;
}

/** Returns the 96 wells of a plate in reading order: A1 to A12, then B1, and so on to H12. */
export function plateWells(): readonly { row: PlateRow; column: PlateColumn; well: WellId }[] {
  return PLATE_ROWS.flatMap((row) =>
    PLATE_COLUMNS.map((column) => ({ row, column, well: wellId(row, column) })),
  );
}
