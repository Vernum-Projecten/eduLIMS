// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { type ChartTableColumn, chartTableRows } from "./table";

interface Row {
  id: string;
  name: string;
  value: number;
}

const rows: readonly Row[] = [
  { id: "a", name: "Alpha", value: 1.5 },
  { id: "b", name: "Beta", value: 20 },
];

const columns: readonly ChartTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "value", header: "Value", cell: (row) => row.value.toFixed(1), numeric: true },
];

describe("chartTableRows", () => {
  it("keeps the rows in the order the chart draws them, one cell per column", () => {
    expect(chartTableRows(rows, columns, (row) => row.id)).toEqual([
      {
        key: "a",
        cells: [
          { columnId: "name", text: "Alpha", rowHeader: true, numeric: false },
          { columnId: "value", text: "1.5", rowHeader: false, numeric: true },
        ],
      },
      {
        key: "b",
        cells: [
          { columnId: "name", text: "Beta", rowHeader: true, numeric: false },
          { columnId: "value", text: "20.0", rowHeader: false, numeric: true },
        ],
      },
    ]);
  });

  it("makes the first column the row header, so each value reads with its row", () => {
    const [first] = chartTableRows(rows, columns, (row) => row.id);
    expect(first?.cells.map((cell) => cell.rowHeader)).toEqual([true, false]);
  });

  it("returns no rows for an empty chart", () => {
    expect(chartTableRows([], columns, (row: Row) => row.id)).toEqual([]);
  });

  it("refuses two rows with the same key", () => {
    const alpha: Row = { id: "a", name: "Alpha", value: 1.5 };
    expect(() => chartTableRows([alpha, alpha], columns, (row) => row.id)).toThrow(
      /duplicate chart table row key: a/,
    );
  });

  it("refuses two columns with the same id", () => {
    const twice = [...columns, { id: "name", header: "Again", cell: (row: Row) => row.name }];
    expect(() => chartTableRows(rows, twice, (row) => row.id)).toThrow(
      /duplicate chart table column: name/,
    );
  });
});
