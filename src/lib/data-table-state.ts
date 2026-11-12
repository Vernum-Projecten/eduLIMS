// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The mapping between a data table's TanStack Table state and the route's URL search params
// (#58): sorting as `sort` and `dir`, pagination as a one-based `page` and `size`, and column
// filters under their own search keys. A default is left out of the URL, so a plain link shows
// the default view and every view has one address.
import {
  type ColumnFiltersState,
  functionalUpdate,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

/** The sort of a table in the URL: a column and a direction; ascending when `dir` is absent. */
export interface SortSearch<TField extends string> {
  sort?: TField | undefined;
  dir?: "asc" | "desc" | undefined;
}

/** The page of a table in the URL: one-based, the first page and the default size left out. */
export interface PageSearch {
  page?: number | undefined;
  size?: number | undefined;
}

/** Returns the table's sorting for the URL's sort: one column, `fallback` when none is given. */
export function sortingFromSearch<TField extends string>(
  search: SortSearch<TField>,
  fallback: TField,
): SortingState {
  return [{ id: search.sort ?? fallback, desc: search.dir === "desc" }];
}

/**
 * Returns the URL's sort for the table's sorting: the first sorted column when it is one of
 * `fields`, else the default; the default column and the ascending direction are left out.
 */
export function searchFromSorting<TField extends string>(
  sorting: SortingState,
  fields: readonly TField[],
  fallback: TField,
): SortSearch<TField> {
  const first = sorting.at(0);
  const field = fields.find((candidate) => candidate === first?.id);
  if (!first || field === undefined) return { sort: undefined, dir: undefined };
  return { sort: field === fallback ? undefined : field, dir: first.desc ? "desc" : undefined };
}

/** Returns the table's pagination for the URL's page: zero-based, `fallbackSize` rows when none. */
export function paginationFromSearch(search: PageSearch, fallbackSize: number): PaginationState {
  return { pageIndex: Math.max(0, (search.page ?? 1) - 1), pageSize: search.size ?? fallbackSize };
}

/** Returns the URL's page for the table's pagination, without the first page or default size. */
export function searchFromPagination(
  pagination: PaginationState,
  fallbackSize: number,
): PageSearch {
  return {
    page: pagination.pageIndex > 0 ? pagination.pageIndex + 1 : undefined,
    size: pagination.pageSize === fallbackSize ? undefined : pagination.pageSize,
  };
}

/** Which column each filtering search key filters: `{ q: "name", role: "roles" }`. */
export type FilterColumns<TKey extends string> = Readonly<Record<TKey, string>>;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Returns the table's column filters for the URL's filter keys; empty values are no filter. */
export function filtersFromSearch<TKey extends string>(
  search: Readonly<Partial<Record<TKey, unknown>>>,
  columns: FilterColumns<TKey>,
): ColumnFiltersState {
  const keys = Object.keys(columns) as TKey[];
  return keys.flatMap((key) => {
    const value = search[key];
    return isEmpty(value) ? [] : [{ id: columns[key], value }];
  });
}

/**
 * Returns the raw value of every filter key for the table's column filters, `undefined` for a
 * column without a filter. The route's search schema validates the values.
 */
export function searchFromFilters<TKey extends string>(
  filters: ColumnFiltersState,
  columns: FilterColumns<TKey>,
): Record<TKey, unknown> {
  const keys = Object.keys(columns) as TKey[];
  const entries = keys.map((key) => {
    const value = filters.find((filter) => filter.id === columns[key])?.value;
    return [key, isEmpty(value) ? undefined : value] as const;
  });
  return Object.fromEntries(entries) as Record<TKey, unknown>;
}

/** The slices of a server-processed table that the URL holds; a table without sorting has none. */
export interface UrlTableState {
  sorting?: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
}

/** A change of one slice the URL holds. */
export type UrlTableChange =
  | { sorting: SortingState }
  | { columnFilters: ColumnFiltersState }
  | { pagination: PaginationState };

/** How one table maps between its route's search and the slices the URL holds. */
export interface UrlTableMapping<TSearch> {
  /** Returns the table's slices for a search. */
  state: (search: TSearch) => UrlTableState;
  /** Returns the search after one change of a slice. */
  next: (prev: TSearch, change: UrlTableChange) => TSearch;
}

/** The change handlers a server-processed table passes to `useTable`. */
export interface UrlTableHandlers {
  onSortingChange: (updater: Updater<SortingState>) => void;
  onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) => void;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
}

/**
 * Returns a table's change handlers. Each one reads the search with `read` when it runs and
 * applies the table's updater to that search, never to the one the page last rendered, so two
 * changes made before a re-render both stay (#194). `write` gets the next and the read search.
 */
export function urlTableHandlers<TSearch>(
  mapping: UrlTableMapping<TSearch>,
  read: () => TSearch,
  write: (next: TSearch, prev: TSearch) => void,
): UrlTableHandlers {
  function apply(change: (state: UrlTableState) => UrlTableChange) {
    const prev = read();
    write(mapping.next(prev, change(mapping.state(prev))), prev);
  }
  return {
    onSortingChange: (updater) =>
      apply((state) => ({ sorting: functionalUpdate(updater, state.sorting ?? []) })),
    onColumnFiltersChange: (updater) =>
      apply((state) => ({ columnFilters: functionalUpdate(updater, state.columnFilters) })),
    onPaginationChange: (updater) =>
      apply((state) => ({ pagination: functionalUpdate(updater, state.pagination) })),
  };
}
