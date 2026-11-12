// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's class table state in the URL (#37): the filter and page slices the route
// controls, read from and written to the validated search params. Isomorphic: the route and its
// tests use it.
import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import {
  type FilterColumns,
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
} from "../../lib/data-table-state.ts";
import {
  ADMIN_CLASS_FILTER_KEYS,
  type AdminClassListSearch,
  type AdminClassStatus,
  adminClassListSearchSchema,
  DEFAULT_ADMIN_CLASS_PAGE_SIZE,
  DEFAULT_ADMIN_CLASS_STATUS,
  type ListAdminClassesInput,
} from "./admin-schemas.ts";

type AdminClassFilterKey = (typeof ADMIN_CLASS_FILTER_KEYS)[number];

/** The column each filtering search key filters: the search text filters the name column. */
export const ADMIN_CLASS_FILTER_COLUMNS = {
  q: "name",
  status: "status",
  year: "year",
  owner: "owner",
  ownerNotTeacher: "ownerNotTeacher",
} as const satisfies FilterColumns<AdminClassFilterKey>;

/** The slices of the class table the URL controls. */
export interface AdminClassesTableState {
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the archive states the list shows: the URL's, else the default (active classes). */
export function effectiveStatus(search: AdminClassListSearch): AdminClassStatus[] {
  return search.status ?? [...DEFAULT_ADMIN_CLASS_STATUS];
}

function isDefaultStatus(status: readonly AdminClassStatus[] | undefined): boolean {
  return (
    status === undefined ||
    (status.length === DEFAULT_ADMIN_CLASS_STATUS.length &&
      status.every((value) => DEFAULT_ADMIN_CLASS_STATUS.includes(value)))
  );
}

/**
 * Returns the class table's state for the URL's search params. The status facet shows the
 * default (Active) as chosen when the URL names none, so the list never looks unfiltered.
 */
export function adminClassesTableState(search: AdminClassListSearch): AdminClassesTableState {
  const shown = { ...search, status: effectiveStatus(search) };
  return {
    columnFilters: filtersFromSearch<AdminClassFilterKey>(shown, ADMIN_CLASS_FILTER_COLUMNS),
    pagination: paginationFromSearch(search, DEFAULT_ADMIN_CLASS_PAGE_SIZE),
  };
}

/** A change of one slice the URL controls. */
export type AdminClassesTableChange =
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

const filterSchema = adminClassListSearchSchema.pick({
  q: true,
  status: true,
  year: true,
  owner: true,
  ownerNotTeacher: true,
});

/**
 * Returns the search params after a change of the table's state. A new filter starts at the
 * first page; filter values pass the route's own schema, so nothing unknown reaches it.
 */
export function nextAdminClassesSearch(
  prev: AdminClassListSearch,
  change: AdminClassesTableChange,
): AdminClassListSearch {
  if ("columnFilters" in change) {
    const filters = filterSchema.parse(
      searchFromFilters(change.columnFilters, ADMIN_CLASS_FILTER_COLUMNS),
    );
    // The default status stays out of the URL, so a plain link and the default view agree.
    const status = isDefaultStatus(filters.status) ? undefined : filters.status;
    return { ...prev, ...filters, status, page: undefined };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_ADMIN_CLASS_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_ADMIN_CLASS_PAGE_SIZE) !== (prev.size ?? DEFAULT_ADMIN_CLASS_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether only the search text differs, so typing replaces the history entry. */
export function onlyClassSearchTextChanged(
  prev: AdminClassListSearch,
  next: AdminClassListSearch,
): boolean {
  const same = (key: Exclude<keyof AdminClassListSearch, "q">) =>
    JSON.stringify(prev[key]) === JSON.stringify(next[key]);
  return (
    prev.q !== next.q &&
    (["status", "year", "owner", "ownerNotTeacher", "size"] as const).every(same)
  );
}

/** Returns whether the search text, or a facet other than the default status, narrows the list. */
export function hasAdminClassFilters(search: AdminClassListSearch): boolean {
  return ADMIN_CLASS_FILTER_KEYS.some((key) =>
    key === "status" ? !isDefaultStatus(search.status) : search[key] !== undefined,
  );
}

/** Returns the server function input for the URL search params, without empty keys. */
export function adminClassesInputFromSearch(search: AdminClassListSearch): ListAdminClassesInput {
  const input: ListAdminClassesInput = {};
  if (search.q) input.q = search.q;
  input.status = effectiveStatus(search);
  if (search.year) input.year = search.year;
  if (search.owner) input.owner = search.owner;
  if (search.ownerNotTeacher) input.ownerNotTeacher = true;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
