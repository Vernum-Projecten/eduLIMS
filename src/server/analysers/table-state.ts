// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The analyser register's state in the URL (B3, #35): the TanStack Table slices the route
// controls, read from and written to the validated search params. Isomorphic: the route and its
// tests use it.
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
  ANALYSER_FILTER_KEYS,
  ANALYSER_SORT_FIELDS,
  type AnalyserListSearch,
  analyserListSearchSchema,
  DEFAULT_ANALYSER_PAGE_SIZE,
  type ListAnalysersInput,
} from "./schemas.ts";

type AnalyserFilterKey = (typeof ANALYSER_FILTER_KEYS)[number];

/** The column each filtering search key filters: the search text filters the model column. */
export const ANALYSER_FILTER_COLUMNS = {
  q: "model",
  status: "status",
  route: "route",
} as const satisfies FilterColumns<AnalyserFilterKey>;

/** The slices of the register the URL controls. */
export interface AnalysersTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the register's state for the URL's search params. */
export function analysersTableState(search: AnalyserListSearch): AnalysersTableState {
  return {
    sorting: sortingFromSearch(search, "model"),
    columnFilters: filtersFromSearch<AnalyserFilterKey>(search, ANALYSER_FILTER_COLUMNS),
    pagination: paginationFromSearch(search, DEFAULT_ANALYSER_PAGE_SIZE),
  };
}

/** A change of one slice the URL controls. */
export type AnalysersTableChange =
  | { sorting: SortingState }
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

const filterSchema = analyserListSearchSchema.pick({ q: true, status: true, route: true });

/**
 * Returns the search params after a change of the table's state. A new sort or filter starts
 * at the first page; filter values pass the route's own schema, so nothing unknown reaches it.
 */
export function nextAnalysersSearch(
  prev: AnalyserListSearch,
  change: AnalysersTableChange,
): AnalyserListSearch {
  if ("sorting" in change) {
    return {
      ...prev,
      ...searchFromSorting(change.sorting, ANALYSER_SORT_FIELDS, "model"),
      page: undefined,
    };
  }
  if ("columnFilters" in change) {
    const filters = filterSchema.parse(
      searchFromFilters(change.columnFilters, ANALYSER_FILTER_COLUMNS),
    );
    return { ...prev, ...filters, page: undefined };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_ANALYSER_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_ANALYSER_PAGE_SIZE) !== (prev.size ?? DEFAULT_ANALYSER_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether only the search text differs, so typing replaces the history entry. */
export function onlyAnalyserSearchChanged(
  prev: AnalyserListSearch,
  next: AnalyserListSearch,
): boolean {
  const same = (key: Exclude<keyof AnalyserListSearch, "q">) =>
    JSON.stringify(prev[key]) === JSON.stringify(next[key]);
  return prev.q !== next.q && (["status", "route", "sort", "dir", "size"] as const).every(same);
}

/** Returns whether the search text or any facet narrows the list. */
export function hasAnalyserFilters(search: AnalyserListSearch): boolean {
  return ANALYSER_FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Returns the server function input for the URL search params, without empty keys. */
export function analyserListInput(search: AnalyserListSearch): ListAnalysersInput {
  const input: ListAnalysersInput = {};
  if (search.q) input.q = search.q;
  if (search.status) input.status = search.status;
  if (search.route) input.route = search.route;
  if (search.sort) input.sort = search.sort;
  if (search.dir) input.dir = search.dir;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
