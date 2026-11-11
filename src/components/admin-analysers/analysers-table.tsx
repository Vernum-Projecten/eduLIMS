// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, useTable } from "@tanstack/react-table";
import { MicroscopeIcon, PlusIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  ANALYSER_ROUTE_ICONS,
  ANALYSER_STATUS_ICONS,
} from "@/components/admin-analysers/analyser-badges";
import { AnalyserFormDialog } from "@/components/admin-analysers/analyser-form-dialog";
import { analysersColumns } from "@/components/admin-analysers/analysers-columns";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { dataTableFeatures } from "@/components/data-table/features";
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
import { ANALYSER_ROUTES, ANALYSER_STATUSES } from "@/lib/analysers";
import { analyserRouteLabel, analyserStatusLabel } from "@/lib/i18n/analyser-labels";
import { formatNumber } from "@/lib/i18n/format";
import { readHiddenColumns } from "@/lib/preferences";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";
import type { AdminAnalysersPage } from "@/server/analysers/query-options";
import {
  ANALYSER_PAGE_SIZES,
  ANALYSER_SEARCH_MAX_LENGTH,
  type AnalyserListSearch,
} from "@/server/analysers/schemas";
import {
  type AnalysersTableChange,
  analysersTableState,
  hasAnalyserFilters,
  nextAnalysersSearch,
  onlyAnalyserSearchChanged,
} from "@/server/analysers/table-state";

/** The id of the register's hidden-columns preference cookie. */
const TABLE_ID = "admin-analysers";

const SORT_LABELS = {
  model: () => m.admin_analysers_col_model(),
  serialNumber: () => m.admin_analysers_col_serial(),
  location: () => m.admin_analysers_col_location(),
  updatedAt: () => m.admin_analysers_col_updated(),
} as const;

function caption(search: AnalyserListSearch, page: number, pages: number): string {
  const values = {
    column: SORT_LABELS[search.sort ?? "model"](),
    page: formatNumber(page),
    pages: formatNumber(pages),
  };
  return search.dir === "desc"
    ? m.admin_analysers_caption_desc(values)
    : m.admin_analysers_caption_asc(values);
}

function AnalysersEmpty({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MicroscopeIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h3>{filtered ? m.admin_analysers_empty_filtered() : m.admin_analysers_empty()}</h3>
        </EmptyTitle>
        <EmptyDescription>
          {filtered ? m.admin_analysers_empty_filtered_body() : m.admin_analysers_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/admin/integrations" search={{}}>
              {m.admin_users_clear_filters()}
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/** The "Add analyser" button and its form dialog, which returns focus to the button. */
function AddAnalyser() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={buttonRef} onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        {m.admin_analysers_add()}
      </Button>
      <AnalyserFormDialog
        control={{
          open,
          onOpenChange: setOpen,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            buttonRef.current?.focus();
          },
        }}
      />
    </>
  );
}

/**
 * The analyser register (B3, #35) on the reusable data table: search, the status and route
 * facets, sorting and pagination, all processed on the server and controlled by the route's
 * search params; hidden columns live in a preference cookie.
 */
export function AnalysersTable({
  page,
  search,
  fetching,
  headingId,
}: Readonly<{
  page: AdminAnalysersPage;
  search: AnalyserListSearch;
  fetching: boolean;
  headingId: string;
}>) {
  const navigate = useNavigate({ from: "/admin/integrations" });
  const state = useMemo(() => analysersTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);

  function change(update: AnalysersTableChange) {
    const next = nextAnalysersSearch(search, update);
    void navigate({
      search: next,
      replace: onlyAnalyserSearchChanged(search, next),
      resetScroll: false,
    });
  }

  const table = useTable({
    features: dataTableFeatures,
    columns: analysersColumns,
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
    onSortingChange: (updater) => change({ sorting: functionalUpdate(updater, state.sorting) }),
    onColumnFiltersChange: (updater) =>
      change({ columnFilters: functionalUpdate(updater, state.columnFilters) }),
    onPaginationChange: (updater) =>
      change({ pagination: functionalUpdate(updater, state.pagination) }),
    onColumnVisibilityChange: (updater) => {
      const next = hiddenFromVisibility(functionalUpdate(updater, columnVisibility));
      setHidden(next);
      // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
      document.cookie = hiddenColumnsCookie(TABLE_ID, next, window.location.protocol === "https:");
    },
  });

  const status = table.getColumn("status");
  const route = table.getColumn("route");
  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            {m.admin_analysers_heading()}
          </h2>
          <p className="text-muted-foreground">{m.admin_analysers_description()}</p>
        </div>
        <AddAnalyser />
      </div>
      <DataTableToolbar
        table={table}
        search={{
          columnId: "model",
          label: m.admin_analysers_search_label(),
          maxLength: ANALYSER_SEARCH_MAX_LENGTH,
          shortcut: true,
        }}
      >
        {status && (
          <DataTableFacetedFilter
            column={status}
            title={m.admin_analysers_filter_status()}
            options={ANALYSER_STATUSES.map((value) => ({
              value,
              label: analyserStatusLabel(value),
              icon: ANALYSER_STATUS_ICONS[value],
            }))}
            counts={page.facets.status}
          />
        )}
        {route && (
          <DataTableFacetedFilter
            column={route}
            title={m.admin_analysers_filter_route()}
            options={ANALYSER_ROUTES.map((value) => ({
              value,
              label: analyserRouteLabel(value),
              icon: ANALYSER_ROUTE_ICONS[value],
            }))}
            counts={page.facets.route}
          />
        )}
      </DataTableToolbar>
      <p role="status" className="sr-only">
        {m.admin_analysers_results({ total: formatNumber(page.total) })}
      </p>
      <DataTable
        table={table}
        caption={caption(search, state.pagination.pageIndex + 1, pages)}
        busy={fetching}
        empty={<AnalysersEmpty filtered={hasAnalyserFilters(search)} />}
      />
      <DataTablePagination
        table={table}
        label={m.admin_analysers_pagination()}
        pageSizes={ANALYSER_PAGE_SIZES}
        range={(range) => m.admin_analysers_range(range)}
      />
    </div>
  );
}
