// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  hasTestFilters,
  nextTestsSearch,
  onlyTestSearchChanged,
  testListInput,
  testsTableState,
} from "./table-state.ts";

describe("the catalogue's state in the URL (D9)", () => {
  it("reads the default sort, no filters and the first page", () => {
    expect(testsTableState({})).toEqual({
      sorting: [{ id: "name", desc: false }],
      columnFilters: [],
      pagination: { pageIndex: 0, pageSize: 25 },
    });
  });

  it("starts at the first page after a new sort or filter", () => {
    expect(nextTestsSearch({ page: 3 }, { sorting: [{ id: "unit", desc: true }] })).toMatchObject({
      sort: "unit",
      dir: "desc",
      page: undefined,
    });
    expect(
      nextTestsSearch({ page: 3 }, { columnFilters: [{ id: "source", value: ["manual"] }] }),
    ).toMatchObject({ source: ["manual"], page: undefined });
  });

  it("keeps the page on a page change and resets it on a new size", () => {
    expect(nextTestsSearch({}, { pagination: { pageIndex: 2, pageSize: 25 } }).page).toBe(3);
    expect(
      nextTestsSearch({ page: 3 }, { pagination: { pageIndex: 2, pageSize: 50 } }),
    ).toMatchObject({ size: 50, page: undefined });
  });

  it("tells a typed search from a filter change, and a filtered list from a plain one", () => {
    expect(onlyTestSearchChanged({ q: "a" }, { q: "ab" })).toBe(true);
    expect(onlyTestSearchChanged({ q: "a" }, { q: "ab", status: ["retired"] })).toBe(false);
    expect(hasTestFilters({})).toBe(false);
    expect(hasTestFilters({ source: ["afinion"] })).toBe(true);
  });

  it("drops empty keys from the server function input", () => {
    expect(testListInput({ q: "glu", status: ["active"], page: 2 })).toEqual({
      q: "glu",
      status: ["active"],
      page: 2,
    });
  });
});
