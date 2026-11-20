// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { ClipboardListIcon } from "lucide-react";
import { useMemo } from "react";
import { TEST_SOURCE_ICONS, TEST_STATUS_ICONS } from "@/components/catalogue/catalogue-badges";
import { catalogueColumns } from "@/components/catalogue/catalogue-columns";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { dataTableFeatures } from "@/components/data-table/features";
import { SERVER_TABLE_OPTIONS, useHiddenColumns } from "@/components/data-table/use-hidden-columns";
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

/** The columns hidden until an administrator shows them (UI review of #404). */
const HIDDEN_BY_DEFAULT = ["updatedAt"] as const;

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
          <h2>{filtered ? m.catalogue_empty_filtered() : m.catalogue_empty()}</h2>
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
  const { columnVisibility, onColumnVisibilityChange } = useHiddenColumns(
    TABLE_ID,
    HIDDEN_BY_DEFAULT,
  );

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
    ...SERVER_TABLE_OPTIONS,
    state: { ...state, columnVisibility },
    ...urlHandlers,
    onColumnVisibilityChange,
  });

  const status = table.getColumn("status");
  const source = table.getColumn("source");
  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-4">
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
