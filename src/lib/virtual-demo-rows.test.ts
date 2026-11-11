// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { demoRows, isDemoSortColumn, sortDemoRows } from "@/lib/virtual-demo-rows";

const rows = demoRows(30);
const ids = (list: readonly { id: string }[]) => list.map((row) => row.id);

describe("sortDemoRows (#76)", () => {
  it("keeps the input order without a sort", () => {
    expect(ids(sortDemoRows(rows, []))).toEqual(ids(rows));
  });

  it("keeps the input order for a column it does not sort by", () => {
    expect(ids(sortDemoRows(rows, [{ id: "analyte", desc: false }]))).toEqual(ids(rows));
  });

  it("sorts by sample ID descending", () => {
    const sorted = sortDemoRows(rows, [{ id: "id", desc: true }]);
    expect(sorted[0]?.id).toBe("VD-00030");
    expect(sorted.at(-1)?.id).toBe("VD-00001");
  });

  it("sorts by value ascending and descending", () => {
    const asc = sortDemoRows(rows, [{ id: "value", desc: false }]).map((row) => row.value);
    const desc = sortDemoRows(rows, [{ id: "value", desc: true }]).map((row) => row.value);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it("puts rows in range first when sorting by status ascending, ties by sample ID", () => {
    const sorted = sortDemoRows(rows, [{ id: "status", desc: false }]);
    const firstOut = sorted.findIndex((row) => !row.inRange);
    expect(firstOut).toBeGreaterThan(0);
    expect(sorted.slice(firstOut).every((row) => !row.inRange)).toBe(true);
    const inRange = ids(sorted.slice(0, firstOut));
    expect(inRange).toEqual([...inRange].sort());
  });

  it("puts rows out of range first when sorting by status descending", () => {
    expect(sortDemoRows(rows, [{ id: "status", desc: true }])[0]?.inRange).toBe(false);
  });

  it("does not change the input", () => {
    const before = ids(rows);
    sortDemoRows(rows, [{ id: "id", desc: true }]);
    expect(ids(rows)).toEqual(before);
  });
});

describe("isDemoSortColumn", () => {
  it.each([
    ["id", true],
    ["value", true],
    ["status", true],
    ["analyte", false],
  ])("%s → %s", (id, expected) => {
    expect(isDemoSortColumn(id)).toBe(expected);
  });
});
