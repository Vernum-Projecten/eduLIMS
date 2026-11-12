// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ColumnFiltersState } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import type { UserListSearch } from "../server/users/schemas.ts";
import { nextUsersSearch, usersTableState } from "../server/users/table-state.ts";
import {
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
  searchFromSorting,
  sortingFromSearch,
  urlTableHandlers,
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

/** A router stand-in: `read` returns the search the last write left, as the router's location. */
function usersUrl(initial: UserListSearch) {
  const url = { search: initial, writes: 0 };
  const handlers = urlTableHandlers(
    { state: usersTableState, next: nextUsersSearch },
    () => url.search,
    (next) => {
      url.search = next;
      url.writes += 1;
    },
  );
  return { url, handlers };
}

/** The updater a faceted filter hands the table: add `value` to the column's chosen values. */
function addValue(columnId: string, value: string) {
  return (old: ColumnFiltersState): ColumnFiltersState => {
    const chosen = old.find((filter) => filter.id === columnId)?.value;
    const values = Array.isArray(chosen) ? [...chosen, value] : [value];
    return [...old.filter((filter) => filter.id !== columnId), { id: columnId, value: values }];
  };
}

describe("table changes start from the current search (#194)", () => {
  it("keeps both of two facet picks made back to back, before a re-render", () => {
    const { url, handlers } = usersUrl({});
    handlers.onColumnFiltersChange(addValue("roles", "teacher"));
    handlers.onColumnFiltersChange(addValue("roles", "admin"));
    expect(url.writes).toBe(2);
    expect(url.search.role).toEqual(["teacher", "admin"]);
  });

  it("keeps a pick in one facet when the next pick is in another", () => {
    const { url, handlers } = usersUrl({});
    handlers.onColumnFiltersChange(addValue("roles", "student"));
    handlers.onColumnFiltersChange(addValue("status", "blocked"));
    expect(url.search).toMatchObject({ role: ["student"], status: ["blocked"] });
  });

  it("keeps a filter picked just before a sort change", () => {
    const { url, handlers } = usersUrl({});
    handlers.onColumnFiltersChange(addValue("roles", "teacher"));
    handlers.onSortingChange([{ id: "lastSignIn", desc: true }]);
    expect(url.search).toMatchObject({ role: ["teacher"], sort: "lastSignIn", dir: "desc" });
  });

  it("applies two page steps back to back from the current page", () => {
    const { url, handlers } = usersUrl({ page: 2 });
    const step = (old: { pageIndex: number; pageSize: number }) => ({
      ...old,
      pageIndex: old.pageIndex + 1,
    });
    handlers.onPaginationChange(step);
    handlers.onPaginationChange(step);
    expect(url.search.page).toBe(4);
  });

  it("hands the writer the search it started from", () => {
    const seen: UserListSearch[] = [];
    const handlers = urlTableHandlers(
      { state: usersTableState, next: nextUsersSearch },
      () => ({ q: "vos" }),
      (_next, prev) => seen.push(prev),
    );
    handlers.onColumnFiltersChange(addValue("roles", "admin"));
    expect(seen).toEqual([{ q: "vos" }]);
  });
});
