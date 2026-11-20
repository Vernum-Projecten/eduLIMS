// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, useTable } from "@tanstack/react-table";
import { FlaskConicalIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { adminSimulationsColumns } from "@/components/admin-simulations/simulations-columns";
import { DataTable } from "@/components/data-table/data-table";
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
import { formatNumber } from "@/lib/i18n/format";
import { readHiddenColumns } from "@/lib/preferences";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";
import {
  ADMIN_SIMULATION_PAGE_SIZES,
  ADMIN_SIMULATION_SEARCH_MAX_LENGTH,
  type AdminSimulationListSearch,
  adminSimulationListSearchSchema,
} from "@/server/simulations/admin-schemas";
import {
  adminSimulationsTableState,
  nextAdminSimulationsSearch,
  onlyAdminSimulationSearchChanged,
} from "@/server/simulations/admin-table-state";
import type { AdminSimulationsPage } from "@/server/simulations/query-options";

/** The id of the list's hidden-columns preference cookie. */
const TABLE_ID = "admin-simulations";

function SimulationsEmpty({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskConicalIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{filtered ? m.admin_simulations_empty_filtered() : m.admin_simulations_empty()}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {filtered ? m.admin_simulations_empty_filtered_body() : m.admin_simulations_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/admin/simulations" search={{}}>
              {m.admin_users_clear_filters()}
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * The administrator's read-only list of simulations (B5, #291) on the reusable data table: a
 * search by name and pages, both processed on the server and held in the route's search params,
 * in the server's fixed order. It has no action; a name opens the detail page.
 */
export function AdminSimulationsTable({
  page,
  search,
  fetching,
}: Readonly<{ page: AdminSimulationsPage; search: AdminSimulationListSearch; fetching: boolean }>) {
  const navigate = useNavigate({ from: "/admin/simulations/" });
  const state = useMemo(() => adminSimulationsTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);

  const urlHandlers = useUrlTable(
    { state: adminSimulationsTableState, next: nextAdminSimulationsSearch },
    adminSimulationListSearchSchema,
    (next, prev) => {
      void navigate({
        search: next,
        replace: onlyAdminSimulationSearchChanged(prev, next),
        resetScroll: false,
      });
    },
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: adminSimulationsColumns,
    data: page.rows,
    rowCount: page.total,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
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

  const pages = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-4">
      <DataTableToolbar
        table={table}
        search={{
          columnId: "name",
          label: m.admin_simulations_search_label(),
          maxLength: ADMIN_SIMULATION_SEARCH_MAX_LENGTH,
          shortcut: true,
        }}
      />
      <p role="status" className="sr-only">
        {m.admin_simulations_results({ total: formatNumber(page.total) })}
      </p>
      <DataTable
        table={table}
        caption={m.admin_simulations_caption({
          page: formatNumber(state.pagination.pageIndex + 1),
          pages: formatNumber(pages),
        })}
        busy={fetching}
        empty={<SimulationsEmpty filtered={search.q !== undefined} />}
      />
      <DataTablePagination
        table={table}
        label={m.admin_simulations_pagination()}
        pageSizes={ADMIN_SIMULATION_PAGE_SIZES}
        range={(range) => m.admin_simulations_range(range)}
      />
    </div>
  );
}
