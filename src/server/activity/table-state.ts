// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The activity table's state in the URL (#36): the TanStack Table slices the route controls,
// read from and written to the validated search params. Isomorphic: the route and its tests use
// it. The period is two search keys (`from`, `to`) and one column filter on the time column.
import type { ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";
import {
  type FilterColumns,
  filtersFromSearch,
  paginationFromSearch,
  searchFromFilters,
  searchFromPagination,
} from "../../lib/data-table-state.ts";
import {
  ACTIVITY_FILTER_KEYS,
  type ActivityListSearch,
  activityListSearchSchema,
  DEFAULT_ACTIVITY_PAGE_SIZE,
  type ListActivityInput,
} from "./schemas.ts";

/** The id of the time column: it sorts, and its filter is the period. */
export const TIME_COLUMN = "occurredAt";

type FacetKey = "actor" | "target" | "action" | "outcome";

/** The column each facet search key filters. */
export const ACTIVITY_FILTER_COLUMNS = {
  actor: "actor",
  target: "target",
  action: "action",
  outcome: "outcome",
} as const satisfies FilterColumns<FacetKey>;

/** The period of the time column's filter: calendar days `YYYY-MM-DD`, either end open. */
export interface ActivityPeriod {
  from?: string | undefined;
  to?: string | undefined;
}

/** Returns `value` as a period when it is one, else `undefined`. */
export function periodOf(value: unknown): ActivityPeriod | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const from: unknown = Reflect.get(value, "from");
  const to: unknown = Reflect.get(value, "to");
  const period: ActivityPeriod = {
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
  };
  return period.from || period.to ? period : undefined;
}

/** The slices of the activity table the URL controls. */
export interface ActivityTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** Returns the activity table's state for the URL's search params; newest first by default. */
export function activityTableState(search: ActivityListSearch): ActivityTableState {
  const columnFilters = filtersFromSearch<FacetKey>(search, ACTIVITY_FILTER_COLUMNS);
  if (search.from || search.to) {
    columnFilters.push({ id: TIME_COLUMN, value: { from: search.from, to: search.to } });
  }
  return {
    sorting: [{ id: TIME_COLUMN, desc: search.dir !== "asc" }],
    columnFilters,
    pagination: paginationFromSearch(search, DEFAULT_ACTIVITY_PAGE_SIZE),
  };
}

/** A change of one slice the URL controls. */
export type ActivityTableChange =
  | { sorting: SortingState }
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

/**
 * Returns the search params after a change of the table's state. A new sort or filter starts at
 * the first page; filter values pass the route's own schema, so nothing unknown reaches it.
 */
export function nextActivitySearch(
  prev: ActivityListSearch,
  change: ActivityTableChange,
): ActivityListSearch {
  if ("sorting" in change) {
    const first = change.sorting.at(0);
    return { ...prev, dir: first && !first.desc ? "asc" : undefined, page: undefined };
  }
  if ("columnFilters" in change) {
    const facets = searchFromFilters(change.columnFilters, ACTIVITY_FILTER_COLUMNS);
    const period = periodOf(change.columnFilters.find((f) => f.id === TIME_COLUMN)?.value);
    const filters = activityListSearchSchema.parse({ ...facets, ...period });
    return {
      ...prev,
      actor: filters.actor,
      target: filters.target,
      action: filters.action,
      outcome: filters.outcome,
      from: filters.from,
      to: filters.to,
      page: undefined,
    };
  }
  const next = searchFromPagination(change.pagination, DEFAULT_ACTIVITY_PAGE_SIZE);
  const sizeChanged =
    (next.size ?? DEFAULT_ACTIVITY_PAGE_SIZE) !== (prev.size ?? DEFAULT_ACTIVITY_PAGE_SIZE);
  return { ...prev, size: next.size, page: sizeChanged ? undefined : next.page };
}

/** Returns whether any filter narrows the log. */
export function hasActivityFilters(search: ActivityListSearch): boolean {
  return ACTIVITY_FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Returns the server function input for the URL search params, without empty keys. */
export function listInputFromSearch(search: ActivityListSearch): ListActivityInput {
  const input: ListActivityInput = {};
  if (search.actor) input.actor = search.actor;
  if (search.target) input.target = search.target;
  if (search.action) input.action = search.action;
  if (search.outcome) input.outcome = search.outcome;
  if (search.from) input.from = search.from;
  if (search.to) input.to = search.to;
  if (search.dir) input.dir = search.dir;
  if (search.page) input.page = search.page;
  if (search.size) input.size = search.size;
  return input;
}
