// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, useTable } from "@tanstack/react-table";
import { HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { activityColumns, OUTCOME_ICONS } from "@/components/admin-activity/activity-columns";
import { PeriodFilter } from "@/components/admin-activity/period-filter";
import { UserFilter } from "@/components/admin-activity/user-filter";
import { DataTable } from "@/components/data-table/data-table";
import {
  DataTableFacetedFilter,
  type FacetOption,
} from "@/components/data-table/data-table-faceted-filter";
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
import { activityOutcomeLabel } from "@/lib/i18n/activity-labels";
import { formatNumber } from "@/lib/i18n/format";
import { auditActionLabel } from "@/lib/i18n/user-labels";
import { readHiddenColumns } from "@/lib/preferences";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";
import type { AdminActivityPage } from "@/server/activity/query-options";
import { ACTIVITY_PAGE_SIZES, type ActivityListSearch } from "@/server/activity/schemas";
import {
  type ActivityTableChange,
  activityTableState,
  hasActivityFilters,
  nextActivitySearch,
} from "@/server/activity/table-state";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "@/server/audit/events";

/** The id of the activity table's hidden-columns preference cookie. */
const TABLE_ID = "admin-activity";

function actionOptions(): FacetOption[] {
  return AUDIT_ACTIONS.map((action) => ({ value: action, label: auditActionLabel(action) }));
}

function outcomeOptions(): FacetOption[] {
  return AUDIT_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: activityOutcomeLabel(outcome),
    icon: OUTCOME_ICONS[outcome],
  }));
}

function caption(search: ActivityListSearch, page: number, pages: number): string {
  const values = { page: formatNumber(page), pages: formatNumber(pages) };
  return search.dir === "asc"
    ? m.admin_activity_caption_asc(values)
    : m.admin_activity_caption_desc(values);
}

function ActivityEmpty({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HistoryIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{filtered ? m.admin_activity_empty_filtered() : m.admin_activity_empty()}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {filtered ? m.admin_activity_empty_filtered_body() : m.admin_activity_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/admin/activity" search={{}}>
              {m.admin_activity_clear_filters()}
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * The activity log table (#36, B4) on the reusable data table: TanStack Table v9 with the time
 * sort, the actor, target, action, outcome and period filters, and pagination, all processed on
 * the server (`manual*` with the server's `rowCount`). The route's search params control every
 * slice, so a view can be shared; hidden columns live in a preference cookie.
 */
export function ActivityTable({
  page,
  search,
  fetching,
}: Readonly<{ page: AdminActivityPage; search: ActivityListSearch; fetching: boolean }>) {
  const navigate = useNavigate({ from: "/admin/activity" });
  const state = useMemo(() => activityTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);

  function change(update: ActivityTableChange) {
    void navigate({ search: nextActivitySearch(search, update) });
  }

  const table = useTable({
    features: dataTableFeatures,
    columns: activityColumns,
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

  const actor = table.getColumn("actor");
  const target = table.getColumn("target");
  const action = table.getColumn("action");
  const outcome = table.getColumn("outcome");
  const time = table.getColumn("occurredAt");
  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-4">
      <DataTableToolbar table={table}>
        {actor && (
          <UserFilter
            column={actor}
            title={m.admin_activity_filter_actor()}
            chosen={page.filterUsers.actor}
          />
        )}
        {target && (
          <UserFilter
            column={target}
            title={m.admin_activity_filter_target()}
            chosen={page.filterUsers.target}
          />
        )}
        {action && (
          <DataTableFacetedFilter
            column={action}
            title={m.admin_activity_filter_action()}
            options={actionOptions()}
            counts={page.facets.action}
          />
        )}
        {outcome && (
          <DataTableFacetedFilter
            column={outcome}
            title={m.admin_activity_filter_outcome()}
            options={outcomeOptions()}
            counts={page.facets.outcome}
          />
        )}
        {time && <PeriodFilter column={time} title={m.admin_activity_filter_period()} />}
      </DataTableToolbar>
      <p role="status" className="sr-only">
        {m.admin_activity_results({ total: formatNumber(page.total) })}
      </p>
      <DataTable
        table={table}
        caption={caption(search, state.pagination.pageIndex + 1, pages)}
        busy={fetching}
        empty={<ActivityEmpty filtered={hasActivityFilters(search)} />}
      />
      <DataTablePagination
        table={table}
        label={m.admin_activity_pagination()}
        pageSizes={ACTIVITY_PAGE_SIZES}
        range={(range) => m.admin_activity_range(range)}
      />
    </div>
  );
}
