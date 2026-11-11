// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type ChartTableColumn, chartTableRows } from "@/lib/charts/table";
import { cn } from "@/lib/utils";

/** The data behind a chart, as the table view shows it. */
export interface ChartTableData<TRow> {
  /** The translated caption: what the table lists. */
  caption: string;
  rows: readonly TRow[];
  columns: readonly ChartTableColumn<TRow>[];
  rowKey: (row: TRow) => string;
}

/**
 * The table view of a chart: the rows the chart draws, with column headers (`scope="col"`), the
 * first column as row header (`scope="row"`) and a caption (WCAG 2.1 SC 1.1.1, 1.3.1).
 */
export function ChartTable<TRow>({
  data,
  id,
}: Readonly<{ data: ChartTableData<TRow>; id: string }>) {
  const rows = chartTableRows(data.rows, data.columns, data.rowKey);
  return (
    <Table id={id}>
      <TableCaption className="mt-0 mb-4 caption-top text-left">{data.caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {data.columns.map((column) => (
            <TableHead key={column.id} scope="col" className={cn(column.numeric && "text-right")}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            {row.cells.map((cell) => {
              const className = cn(cell.numeric && "text-right tabular-nums");
              return cell.rowHeader ? (
                <TableHead key={cell.columnId} scope="row" className={cn("font-medium", className)}>
                  {cell.text}
                </TableHead>
              ) : (
                <TableCell key={cell.columnId} className={className}>
                  {cell.text}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
