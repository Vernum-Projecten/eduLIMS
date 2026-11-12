// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, type RowSelectionState, useTable } from "@tanstack/react-table";
import { UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useProviderLabels } from "@/components/admin-users/provider-labels";
import { STATUS_ICONS } from "@/components/admin-users/user-badges";
import { UsersBulkActions } from "@/components/admin-users/users-bulk-actions";
import { usersColumns } from "@/components/admin-users/users-columns";
import { UsersTableContext } from "@/components/admin-users/users-table-context";
import { DataTable } from "@/components/data-table/data-table";
import {
  DataTableFacetedFilter,
  type FacetOption,
} from "@/components/data-table/data-table-faceted-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableBulkBar } from "@/components/data-table/data-table-selection";
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
import { roleLabel } from "@/lib/i18n/labels";
import { signInMethodLabel, userStatusLabel } from "@/lib/i18n/user-labels";
import { readHiddenColumns } from "@/lib/preferences";
import { ROLE_ICONS } from "@/lib/role-icons";
import { ROLES } from "@/lib/roles";
import {
  hiddenColumnsCookie,
  hiddenFromVisibility,
  visibilityFromHidden,
} from "@/lib/table-columns";
import type { AdminUsersPage } from "@/server/users/query-options";
import {
  SEARCH_MAX_LENGTH,
  USER_PAGE_SIZES,
  USER_STATUSES,
  type UserListSearch,
  userListSearchSchema,
} from "@/server/users/schemas";
import {
  hasUserFilters,
  listInputFromSearch,
  nextUsersSearch,
  onlySearchTextChanged,
  usersTableState,
} from "@/server/users/table-state";

/** The id of the users table's hidden-columns preference cookie. */
const TABLE_ID = "admin-users";

const NO_SELECTION: RowSelectionState = {};

function roleOptions(): FacetOption[] {
  return ROLES.map((role) => ({
    value: role,
    label: roleLabel(role),
    icon: ROLE_ICONS[role],
  }));
}

function statusOptions(): FacetOption[] {
  return USER_STATUSES.map((status) => ({
    value: status,
    label: userStatusLabel(status),
    icon: STATUS_ICONS[status],
  }));
}

function caption(search: UserListSearch, page: number, pages: number): string {
  const column =
    (search.sort ?? "name") === "name"
      ? m.admin_users_col_user()
      : m.admin_users_col_last_sign_in();
  const values = { column, page: formatNumber(page), pages: formatNumber(pages) };
  return search.dir === "desc"
    ? m.admin_users_caption_desc(values)
    : m.admin_users_caption_asc(values);
}

function UsersEmpty({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{filtered ? m.admin_users_empty_filtered() : m.admin_users_empty()}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {filtered ? m.admin_users_empty_filtered_body() : m.admin_users_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/admin/users" search={{}}>
              {m.admin_users_clear_filters()}
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * The users table (#34, #58) on the reusable data table: TanStack Table v9 with sorting,
 * filtering, pagination, column visibility and row selection, all processed on the server
 * (`manual*` with the server's `rowCount`). Sorting, filters and the page are controlled by the
 * route's search params; hidden columns by a preference cookie; the selection is local and
 * cleared whenever the list changes.
 */
export function UsersTable({
  page,
  search,
  selfId,
  fetching,
}: Readonly<{ page: AdminUsersPage; search: UserListSearch; selfId: string; fetching: boolean }>) {
  const navigate = useNavigate({ from: "/admin/users" });
  const state = useMemo(() => usersTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(() => visibilityFromHidden(hidden), [hidden]);
  const listKey = JSON.stringify(listInputFromSearch(search));
  const [selection, setSelection] = useState({ key: listKey, value: NO_SELECTION });
  const rowSelection = selection.key === listKey ? selection.value : NO_SELECTION;

  const urlHandlers = useUrlTable(
    { state: usersTableState, next: nextUsersSearch },
    userListSearchSchema,
    (next, prev) => {
      void navigate({ search: next, replace: onlySearchTextChanged(prev, next) });
    },
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: usersColumns,
    data: page.rows,
    rowCount: page.total,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    enableRowSelection: (row) => row.original.id !== selfId,
    state: { ...state, columnVisibility, rowSelection },
    ...urlHandlers,
    onColumnVisibilityChange: (updater) => {
      const next = hiddenFromVisibility(functionalUpdate(updater, columnVisibility));
      setHidden(next);
      // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
      document.cookie = hiddenColumnsCookie(TABLE_ID, next, window.location.protocol === "https:");
    },
    onRowSelectionChange: (updater) =>
      setSelection({ key: listKey, value: functionalUpdate(updater, rowSelection) }),
  });

  const roles = table.getColumn("roles");
  const providers = table.getColumn("providers");
  const status = table.getColumn("status");
  const pages = Math.max(1, table.getPageCount());
  const labels = useProviderLabels();
  const context = useMemo(() => ({ readAt: page.readAt, selfId }), [page.readAt, selfId]);

  return (
    <UsersTableContext value={context}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <DataTableToolbar
          table={table}
          search={{
            columnId: "name",
            label: m.admin_users_search_label(),
            maxLength: SEARCH_MAX_LENGTH,
            shortcut: true,
          }}
        >
          {roles && (
            <DataTableFacetedFilter
              column={roles}
              title={m.admin_users_filter_role()}
              options={roleOptions()}
              counts={page.facets.role}
            />
          )}
          {providers && (
            <DataTableFacetedFilter
              column={providers}
              title={m.admin_users_filter_provider()}
              options={page.providerOptions.map((provider) => ({
                value: provider,
                label: signInMethodLabel(provider, labels),
              }))}
              counts={page.facets.provider}
            />
          )}
          {status && (
            <DataTableFacetedFilter
              column={status}
              title={m.admin_users_filter_status()}
              options={statusOptions()}
              counts={page.facets.status}
            />
          )}
        </DataTableToolbar>
        <p role="status" className="sr-only">
          {m.admin_users_results({ total: formatNumber(page.total) })}
        </p>
        <DataTableBulkBar table={table}>
          <UsersBulkActions
            userIds={table.getSelectedRowIds()}
            onDone={() => table.resetRowSelection(true)}
          />
        </DataTableBulkBar>
        <DataTable
          table={table}
          caption={caption(search, state.pagination.pageIndex + 1, pages)}
          busy={fetching}
          fill
          empty={<UsersEmpty filtered={hasUserFilters(search)} />}
        />
        <DataTablePagination
          table={table}
          label={m.admin_users_pagination()}
          pageSizes={USER_PAGE_SIZES}
          range={(range) => m.admin_users_range(range)}
        />
      </div>
    </UsersTableContext>
  );
}
