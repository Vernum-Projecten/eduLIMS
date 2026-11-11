// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The mapping between a data table's TanStack Table state and the route's URL search params
// (#58): sorting as `sort` and `dir`, pagination as a one-based `page` and `size`, and column
// filters under their own search keys. A default is left out of the URL, so a plain link shows
// the default view and every view has one address.
import type { ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";

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
