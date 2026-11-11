// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { demoRows } from "@/lib/virtual-demo-rows";
import {
  ariaRowPosition,
  clampRowIndex,
  isRowNavigationKey,
  nextRowIndex,
  rowsPerPage,
  withActiveRow,
} from "@/lib/virtual-rows";

describe("nextRowIndex", () => {
  it.each([
    ["ArrowDown", 5, 6],
    ["ArrowUp", 5, 4],
    ["Home", 5, 0],
    ["End", 5, 9999],
    ["PageDown", 5, 15],
    ["PageUp", 15, 5],
  ])("%s from row %i moves to row %i", (key, from, to) => {
    expect(nextRowIndex(key, from, 10_000, 10)).toBe(to);
  });

  it("stops at the first row", () => {
    expect(nextRowIndex("ArrowUp", 0, 10, 3)).toBe(0);
    expect(nextRowIndex("PageUp", 2, 10, 3)).toBe(0);
  });

  it("stops at the last row", () => {
    expect(nextRowIndex("ArrowDown", 9, 10, 3)).toBe(9);
    expect(nextRowIndex("PageDown", 8, 10, 3)).toBe(9);
  });

  it("lands on the first row when no row is active, except End", () => {
    expect(nextRowIndex("ArrowDown", null, 10, 3)).toBe(0);
    expect(nextRowIndex("ArrowUp", null, 10, 3)).toBe(0);
    expect(nextRowIndex("PageDown", null, 10, 3)).toBe(0);
    expect(nextRowIndex("PageUp", null, 10, 3)).toBe(0);
    expect(nextRowIndex("End", null, 10, 3)).toBe(9);
  });

  it("ignores keys that do not navigate", () => {
    expect(nextRowIndex("Enter", 3, 10, 3)).toBeNull();
    expect(nextRowIndex("a", 3, 10, 3)).toBeNull();
  });

  it("does nothing in an empty list", () => {
    expect(nextRowIndex("ArrowDown", null, 0, 3)).toBeNull();
  });

  it("clamps a stale active row after the list shrank", () => {
    expect(nextRowIndex("ArrowUp", 50, 10, 3)).toBe(8);
  });

  it("moves at least one row per page", () => {
    expect(nextRowIndex("PageDown", 0, 10, 0)).toBe(1);
  });
});

describe("row math", () => {
  it("recognises the navigation keys", () => {
    expect(isRowNavigationKey("PageDown")).toBe(true);
    expect(isRowNavigationKey("Tab")).toBe(false);
  });

  it("clamps into the list", () => {
    expect(clampRowIndex(-3, 10)).toBe(0);
    expect(clampRowIndex(12, 10)).toBe(9);
    expect(clampRowIndex(4, 10)).toBe(4);
  });

  it("counts the rows that fit a viewport", () => {
    expect(rowsPerPage(480, 56)).toBe(8);
    expect(rowsPerPage(20, 56)).toBe(1);
    expect(rowsPerPage(0, 56)).toBe(1);
    expect(rowsPerPage(480, 0)).toBe(1);
    expect(rowsPerPage(Number.NaN, 56)).toBe(1);
  });

  it("gives 1-based ARIA positions, after any header rows", () => {
    expect(ariaRowPosition(0)).toBe(1);
    expect(ariaRowPosition(9999)).toBe(10_000);
    expect(ariaRowPosition(0, 1)).toBe(2);
  });

  it("keeps the active row rendered, in order and once", () => {
    expect(withActiveRow([10, 11, 12], 2)).toEqual([2, 10, 11, 12]);
    expect(withActiveRow([10, 11, 12], 500)).toEqual([10, 11, 12, 500]);
    expect(withActiveRow([10, 11, 12], 11)).toEqual([10, 11, 12]);
    expect(withActiveRow([10, 11], null)).toEqual([10, 11]);
  });
});

describe("demoRows", () => {
  it("is deterministic, so the server and the client render the same rows", () => {
    expect(demoRows(50)).toEqual(demoRows(50));
  });

  it("gives every row a unique sample ID", () => {
    const rows = demoRows(10_000);
    expect(new Set(rows.map((row) => row.id)).size).toBe(10_000);
    expect(rows.at(0)?.id).toBe("VD-00001");
    expect(rows.at(-1)?.id).toBe("VD-10000");
  });

  it("mixes row heights and statuses", () => {
    const rows = demoRows(90);
    expect(rows.filter((row) => row.hasNote)).toHaveLength(10);
    expect(rows.some((row) => !row.inRange)).toBe(true);
  });
});
