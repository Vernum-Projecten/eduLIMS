// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useTable } from "@tanstack/react-table";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";

interface Event {
  id: string;
  time: string;
}

const helper = createDataTableColumnHelper<Event>();
const columns = helper.columns([helper.accessor("time", { id: "time", header: "Time" })]);

/** One server page of `size` events that all share one minute, as the activity log can (#222). */
function samePage(pageIndex: number, size: number, total: number): Event[] {
  return Array.from(
    { length: Math.min(size, Math.max(0, total - pageIndex * size)) },
    (_, index) => ({
      id: `event-${pageIndex * size + index}`,
      time: "Nov 12, 2026, 12:51 PM",
    }),
  );
}

function PagedTable({
  pageIndex,
  size,
  total,
}: Readonly<{ pageIndex: number; size: number; total: number }>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: samePage(pageIndex, size, total),
    rowCount: total,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    state: { pagination: { pageIndex, pageSize: size } },
  });
  return <DataTable table={table} caption="Events" empty={<p>None</p>} />;
}

function positions(html: string): number[] {
  return [...html.matchAll(/<tr[^>]*aria-rowindex="(\d+)"/g)].map((match) => Number(match[1]));
}

describe("DataTable row positions on a server-paginated table (WCAG 1.3.1)", () => {
  it("gives the table the row count of the whole set plus its header row", () => {
    const html = renderToString(<PagedTable pageIndex={0} size={25} total={120} />);
    expect(html).toMatch(/<table[^>]*aria-rowcount="121"/);
  });

  it("numbers page 1 from the row after the header", () => {
    const html = renderToString(<PagedTable pageIndex={0} size={25} total={120} />);
    expect(positions(html)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  });

  it("tells page 2 from page 1 when every row reads the same minute (#222)", () => {
    const first = renderToString(<PagedTable pageIndex={0} size={25} total={120} />);
    const second = renderToString(<PagedTable pageIndex={1} size={25} total={120} />);
    expect(positions(second)).toEqual([1, ...Array.from({ length: 25 }, (_, i) => i + 27)]);
    expect(positions(second).slice(1)).not.toEqual(positions(first).slice(1));
  });

  it("sets no row count when the page is empty", () => {
    const html = renderToString(<PagedTable pageIndex={0} size={25} total={0} />);
    expect(html).not.toContain("aria-rowcount");
    expect(html).not.toContain("aria-rowindex");
  });
});
