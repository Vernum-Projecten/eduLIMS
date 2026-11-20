// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's list of simulations in the URL (B5, #291): the TanStack Table slices the
// route controls, read from and written to the validated search params. The order is fixed
// (newest first), so the list has no sorting slice. Isomorphic: the route and its tests use it.
import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import {
  type FilterColumns,
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
  type UrlTableChange,
} from "../../lib/data-table-state.ts";
import {
  type AdminSimulationListSearch,
  adminSimulationListSearchSchema,
  DEFAULT_ADMIN_SIMULATION_PAGE_SIZE,
  type ListAdminSimulationsInput,
} from "./admin-schemas.ts";

/** The column the search text filters. */
export const ADMIN_SIMULATION_FILTER_COLUMNS = {
  q: "name",
} as const satisfies FilterColumns<"q">;

/** The slices of the list the URL controls. */
export interface AdminSimulationsTableState {
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the list's state for the URL's search params. */
export function adminSimulationsTableState(
  search: AdminSimulationListSearch,
): AdminSimulationsTableState {
  return {
    columnFilters: filtersFromSearch<"q">(search, ADMIN_SIMULATION_FILTER_COLUMNS),
    pagination: paginationFromSearch(search, DEFAULT_ADMIN_SIMULATION_PAGE_SIZE),
  };
}

const filterSchema = adminSimulationListSearchSchema.pick({ q: true });

/**
 * Returns the search params after a change of the table's state. A new search starts at the
 * first page, and so does a new page size; the search text passes the route's own schema.
 */
export function nextAdminSimulationsSearch(
  prev: AdminSimulationListSearch,
  change: UrlTableChange,
): AdminSimulationListSearch {
  if ("sorting" in change) return prev;
  if ("columnFilters" in change) {
    const filters = filterSchema.parse(
      searchFromFilters(change.columnFilters, ADMIN_SIMULATION_FILTER_COLUMNS),
    );
    return { ...prev, ...filters, page: undefined };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_ADMIN_SIMULATION_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_ADMIN_SIMULATION_PAGE_SIZE) !==
    (prev.size ?? DEFAULT_ADMIN_SIMULATION_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether only the search text differs, so typing replaces the history entry. */
export function onlyAdminSimulationSearchChanged(
  prev: AdminSimulationListSearch,
  next: AdminSimulationListSearch,
): boolean {
  return prev.q !== next.q && prev.size === next.size;
}

/** Returns the server function input for the URL search params, without empty keys. */
export function adminSimulationListInput(
  search: AdminSimulationListSearch,
): ListAdminSimulationsInput {
  const input: ListAdminSimulationsInput = {};
  if (search.q) input.q = search.q;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
