// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test catalogue's state in the URL (D9, #266): the TanStack Table slices the route controls,
// read from and written to the validated search params. Isomorphic: the route and its tests use
// it.
import type { ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";
import {
  type FilterColumns,
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
  searchFromSorting,
  sortingFromSearch,
} from "../../lib/data-table-state.ts";
import {
  DEFAULT_TEST_PAGE_SIZE,
  type ListTestsInput,
  TEST_FILTER_KEYS,
  TEST_SORT_FIELDS,
  type TestListSearch,
  testListSearchSchema,
} from "./schemas.ts";

type TestFilterKey = (typeof TEST_FILTER_KEYS)[number];

/** The column each filtering search key filters: the search text filters the name column. */
export const TEST_FILTER_COLUMNS = {
  q: "name",
  status: "status",
  source: "source",
} as const satisfies FilterColumns<TestFilterKey>;

/** The slices of the catalogue the URL controls. */
export interface TestsTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the catalogue's state for the URL's search params. */
export function testsTableState(search: TestListSearch): TestsTableState {
  return {
    sorting: sortingFromSearch(search, "name"),
    columnFilters: filtersFromSearch<TestFilterKey>(search, TEST_FILTER_COLUMNS),
    pagination: paginationFromSearch(search, DEFAULT_TEST_PAGE_SIZE),
  };
}

/** A change of one slice the URL controls. */
export type TestsTableChange =
  | { sorting: SortingState }
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

const filterSchema = testListSearchSchema.pick({ q: true, status: true, source: true });

/**
 * Returns the search params after a change of the table's state. A new sort or filter starts at
 * the first page; filter values pass the route's own schema, so nothing unknown reaches it.
 */
export function nextTestsSearch(prev: TestListSearch, change: TestsTableChange): TestListSearch {
  if ("sorting" in change) {
    return {
      ...prev,
      ...searchFromSorting(change.sorting, TEST_SORT_FIELDS, "name"),
      page: undefined,
    };
  }
  if ("columnFilters" in change) {
    const filters = filterSchema.parse(
      searchFromFilters(change.columnFilters, TEST_FILTER_COLUMNS),
    );
    return { ...prev, ...filters, page: undefined };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_TEST_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_TEST_PAGE_SIZE) !== (prev.size ?? DEFAULT_TEST_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether only the search text differs, so typing replaces the history entry. */
export function onlyTestSearchChanged(prev: TestListSearch, next: TestListSearch): boolean {
  const same = (key: Exclude<keyof TestListSearch, "q">) =>
    JSON.stringify(prev[key]) === JSON.stringify(next[key]);
  return prev.q !== next.q && (["status", "source", "sort", "dir", "size"] as const).every(same);
}

/** Returns whether the search text or any facet narrows the list. */
export function hasTestFilters(search: TestListSearch): boolean {
  return TEST_FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Returns the server function input for the URL search params, without empty keys. */
export function testListInput(search: TestListSearch): ListTestsInput {
  const input: ListTestsInput = {};
  if (search.q) input.q = search.q;
  if (search.status) input.status = search.status;
  if (search.source) input.source = search.source;
  if (search.sort) input.sort = search.sort;
  if (search.dir) input.dir = search.dir;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
