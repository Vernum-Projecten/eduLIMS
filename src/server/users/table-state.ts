// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The users table's state in the URL (#58): the TanStack Table slices the route controls, read
// from and written to the validated search params. Isomorphic: the route and its tests use it.
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
  DEFAULT_USER_PAGE_SIZE,
  type ListUsersInput,
  USER_FILTER_KEYS,
  USER_SORT_FIELDS,
  type UserListSearch,
  userListSearchSchema,
} from "./schemas.ts";

type UserFilterKey = (typeof USER_FILTER_KEYS)[number];

/** The column each filtering search key filters: the search text filters the name column. */
export const USER_FILTER_COLUMNS = {
  q: "name",
  role: "roles",
  provider: "providers",
  status: "status",
} as const satisfies FilterColumns<UserFilterKey>;

/** The slices of the users table the URL controls. */
export interface UsersTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the users table's state for the URL's search params. */
export function usersTableState(search: UserListSearch): UsersTableState {
  return {
    sorting: sortingFromSearch(search, "name"),
    columnFilters: filtersFromSearch<UserFilterKey>(search, USER_FILTER_COLUMNS),
    pagination: paginationFromSearch(search, DEFAULT_USER_PAGE_SIZE),
  };
}

/** A change of one slice the URL controls. */
export type UsersTableChange =
  | { sorting: SortingState }
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

const filterSchema = userListSearchSchema.pick({
  q: true,
  role: true,
  provider: true,
  status: true,
});

/**
 * Returns the search params after a change of the table's state. A new sort or filter starts
 * at the first page; filter values pass the route's own schema, so nothing unknown reaches it.
 */
export function nextUsersSearch(prev: UserListSearch, change: UsersTableChange): UserListSearch {
  if ("sorting" in change) {
    return {
      ...prev,
      ...searchFromSorting(change.sorting, USER_SORT_FIELDS, "name"),
      page: undefined,
    };
  }
  if ("columnFilters" in change) {
    const filters = filterSchema.parse(
      searchFromFilters(change.columnFilters, USER_FILTER_COLUMNS),
    );
    return { ...prev, ...filters, page: undefined };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_USER_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_USER_PAGE_SIZE) !== (prev.size ?? DEFAULT_USER_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether only the search text differs, so typing replaces the history entry. */
export function onlySearchTextChanged(prev: UserListSearch, next: UserListSearch): boolean {
  const same = (key: Exclude<keyof UserListSearch, "q">) =>
    JSON.stringify(prev[key]) === JSON.stringify(next[key]);
  return (
    prev.q !== next.q &&
    (["role", "provider", "status", "sort", "dir", "size"] as const).every(same)
  );
}

/** Returns whether the search text or any facet narrows the list. */
export function hasUserFilters(search: UserListSearch): boolean {
  return USER_FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Returns the server function input for the URL search params, without empty keys. */
export function listInputFromSearch(search: UserListSearch): ListUsersInput {
  const input: ListUsersInput = {};
  if (search.q) input.q = search.q;
  if (search.role) input.role = search.role;
  if (search.provider) input.provider = search.provider;
  if (search.status) input.status = search.status;
  if (search.sort) input.sort = search.sort;
  if (search.dir) input.dir = search.dir;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
