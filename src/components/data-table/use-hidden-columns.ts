// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type ColumnVisibilityState, functionalUpdate, type Updater } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { readHiddenColumns } from "@/lib/preferences";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";

/**
 * The hidden columns of the table `tableId`, kept in its preference cookie so the server renders
 * the same columns on the next request: the visibility state and its change handler for
 * `useTable`.
 */
export function useHiddenColumns(tableId: string) {
  const [hidden, setHidden] = useState(() => readHiddenColumns(tableId));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);
  const onColumnVisibilityChange = (updater: Updater<ColumnVisibilityState>) => {
    const next = hiddenFromVisibility(functionalUpdate(updater, columnVisibility));
    setHidden(next);
    // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
    document.cookie = hiddenColumnsCookie(tableId, next, window.location.protocol === "https:");
  };
  return { columnVisibility, onColumnVisibilityChange };
}

/** The options of a table whose rows the server sorts, filters and pages, one sort at a time. */
export const SERVER_TABLE_OPTIONS = {
  manualSorting: true,
  manualFiltering: true,
  manualPagination: true,
  enableMultiSort: false,
  enableSortingRemoval: false,
  enableRowSelection: false,
} as const;
