// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, useTable } from "@tanstack/react-table";
import { ClipboardListIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { TEST_SOURCE_ICONS, TEST_STATUS_ICONS } from "@/components/catalogue/catalogue-badges";
import { catalogueColumns } from "@/components/catalogue/catalogue-columns";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { dataTableFeatures } from "@/components/data-table/features";
import { useUrlTable } from "@/components/data-table/use-url-table";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { TEST_SOURCES, TEST_STATUSES } from "@/lib/catalogue";
import { testSourceLabel, testStatusLabel } from "@/lib/i18n/catalogue-labels";
import { formatNumber } from "@/lib/i18n/format";
import { readHiddenColumns } from "@/lib/preferences";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";
import type { CatalogueTestsPage } from "@/server/catalogue/query-options";
import {
  TEST_PAGE_SIZES,
  TEST_SEARCH_MAX_LENGTH,
  type TestListSearch,
  testListSearchSchema,
} from "@/server/catalogue/schemas";
import {
  hasTestFilters,
  nextTestsSearch,
  onlyTestSearchChanged,
  testsTableState,
} from "@/server/catalogue/table-state";

/** The id of the catalogue's hidden-columns preference cookie. */
const TABLE_ID = "admin-catalogue";

const SORT_LABELS = {
  name: () => m.catalogue_col_name(),
  unit: () => m.catalogue_col_unit(),
  material: () => m.catalogue_col_material(),
  updatedAt: () => m.catalogue_col_updated(),
} as const;

function caption(search: TestListSearch, page: number, pages: number): string {
  const values = {
    column: SORT_LABELS[search.sort ?? "name"](),
    page: formatNumber(page),
    pages: formatNumber(pages),
  };
  return search.dir === "desc" ? m.catalogue_caption_desc(values) : m.catalogue_caption_asc(values);
}

function CatalogueEmpty({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ClipboardListIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h3>{filtered ? m.catalogue_empty_filtered() : m.catalogue_empty()}</h3>
        </EmptyTitle>
        <EmptyDescription>
          {filtered ? m.catalogue_empty_filtered_body() : m.catalogue_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/admin/catalogue" search={{}}>
              {m.common_clear_filters()}
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * The test catalogue (D9, #266, #393) on the reusable data table: search, the status and source
 * facets, sorting and pagination, all processed on the server and controlled by the route's
 * search params; hidden columns live in a preference cookie. The page frame above it holds the
 * one primary action, "Add test" (#384).
 */
export function CatalogueTable({
  page,
  search,
  fetching,
}: Readonly<{
  page: CatalogueTestsPage;
  search: TestListSearch;
  fetching: boolean;
}>) {
  const navigate = useNavigate({ from: "/admin/catalogue" });
  const state = useMemo(() => testsTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);

  const urlHandlers = useUrlTable(
    { state: testsTableState, next: nextTestsSearch },
    testListSearchSchema,
    (next, prev) => {
      void navigate({
        search: next,
        replace: onlyTestSearchChanged(prev, next),
        resetScroll: false,
      });
    },
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: catalogueColumns,
    data: page.rows,
    rowCount: page.total,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    enableRowSelection: false,
    state: { ...state, columnVisibility },
    ...urlHandlers,
    onColumnVisibilityChange: (updater) => {
      const next = hiddenFromVisibility(functionalUpdate(updater, columnVisibility));
      setHidden(next);
      // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
      document.cookie = hiddenColumnsCookie(TABLE_ID, next, window.location.protocol === "https:");
    },
  });

  const status = table.getColumn("status");
  const source = table.getColumn("source");
  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DataTableToolbar
        table={table}
        search={{
          columnId: "name",
          label: m.catalogue_search_label(),
          maxLength: TEST_SEARCH_MAX_LENGTH,
          shortcut: true,
        }}
      >
        {status && (
          <DataTableFacetedFilter
            column={status}
            title={m.catalogue_filter_status()}
            options={TEST_STATUSES.map((value) => ({
              value,
              label: testStatusLabel(value),
              icon: TEST_STATUS_ICONS[value],
            }))}
            counts={page.facets.status}
          />
        )}
        {source && (
          <DataTableFacetedFilter
            column={source}
            title={m.catalogue_filter_source()}
            options={TEST_SOURCES.map((value) => ({
              value,
              label: testSourceLabel(value),
              icon: TEST_SOURCE_ICONS[value],
            }))}
            counts={page.facets.source}
          />
        )}
      </DataTableToolbar>
      <p role="status" className="sr-only">
        {m.catalogue_results({ total: formatNumber(page.total) })}
      </p>
      <DataTable
        table={table}
        caption={caption(search, state.pagination.pageIndex + 1, pages)}
        busy={fetching}
        fill
        empty={<CatalogueEmpty filtered={hasTestFilters(search)} />}
      />
      <DataTablePagination
        table={table}
        label={m.catalogue_pagination()}
        pageSizes={TEST_PAGE_SIZES}
        range={(range) => m.catalogue_range(range)}
      />
    </div>
  );
}
