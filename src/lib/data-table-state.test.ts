// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
  searchFromSorting,
  sortingFromSearch,
} from "./data-table-state.ts";

const FIELDS = ["name", "lastSignIn"] as const;
const COLUMNS = { q: "name", role: "roles" } as const;

describe("sorting in the URL (#58)", () => {
  it("defaults to the fallback column, ascending", () => {
    expect(sortingFromSearch({}, "name")).toEqual([{ id: "name", desc: false }]);
  });

  it("reads a column and a descending direction", () => {
    expect(sortingFromSearch({ sort: "lastSignIn", dir: "desc" }, "name")).toEqual([
      { id: "lastSignIn", desc: true },
    ]);
  });

  it("leaves the default column and the ascending direction out of the URL", () => {
    expect(searchFromSorting([{ id: "name", desc: false }], FIELDS, "name")).toEqual({
      sort: undefined,
      dir: undefined,
    });
    expect(searchFromSorting([{ id: "name", desc: true }], FIELDS, "name")).toEqual({
      sort: undefined,
      dir: "desc",
    });
    expect(searchFromSorting([{ id: "lastSignIn", desc: false }], FIELDS, "name")).toEqual({
      sort: "lastSignIn",
      dir: undefined,
    });
  });

  it("falls back to the default for no sorting or a column it cannot sort", () => {
    expect(searchFromSorting([], FIELDS, "name")).toEqual({ sort: undefined, dir: undefined });
    expect(searchFromSorting([{ id: "roles", desc: true }], FIELDS, "name")).toEqual({
      sort: undefined,
      dir: undefined,
    });
  });

  it("round-trips every sort", () => {
    for (const sort of FIELDS) {
      for (const desc of [false, true]) {
        const search = searchFromSorting([{ id: sort, desc }], FIELDS, "name");
        expect(sortingFromSearch(search, "name")).toEqual([{ id: sort, desc }]);
      }
    }
  });
});

describe("pagination in the URL (#58)", () => {
  it("maps the one-based page to the zero-based index and back", () => {
    expect(paginationFromSearch({}, 25)).toEqual({ pageIndex: 0, pageSize: 25 });
    expect(paginationFromSearch({ page: 3, size: 10 }, 25)).toEqual({ pageIndex: 2, pageSize: 10 });
    expect(searchFromPagination({ pageIndex: 2, pageSize: 10 }, 25)).toEqual({ page: 3, size: 10 });
  });

  it("leaves the first page and the default size out of the URL", () => {
    expect(searchFromPagination({ pageIndex: 0, pageSize: 25 }, 25)).toEqual({
      page: undefined,
      size: undefined,
    });
  });
});

describe("column filters in the URL (#58)", () => {
  it("maps each search key to its column and leaves empty values out", () => {
    expect(filtersFromSearch({ q: "anna", role: ["teacher"] }, COLUMNS)).toEqual([
      { id: "name", value: "anna" },
      { id: "roles", value: ["teacher"] },
    ]);
    expect(filtersFromSearch({ q: "", role: [] }, COLUMNS)).toEqual([]);
  });

  it("maps the column filters back to every search key", () => {
    expect(searchFromFilters([{ id: "roles", value: ["admin", "teacher"] }], COLUMNS)).toEqual({
      q: undefined,
      role: ["admin", "teacher"],
    });
    expect(
      searchFromFilters(
        [
          { id: "roles", value: [] },
          { id: "name", value: "" },
        ],
        COLUMNS,
      ),
    ).toEqual({ q: undefined, role: undefined });
  });
});
