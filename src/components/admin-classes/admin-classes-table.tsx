// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, useTable } from "@tanstack/react-table";
import { ArchiveIcon, CircleCheckIcon, SchoolIcon, ShieldAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { ClassName, displayYear } from "@/components/classes/class-name";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
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
import type { AdminClassesPage } from "@/server/classes/admin-query-options";
import {
  ADMIN_CLASS_PAGE_SIZES,
  ADMIN_CLASS_SEARCH_MAX,
  ADMIN_CLASS_STATUSES,
  type AdminClassListSearch,
  type AdminClassStatus,
} from "@/server/classes/admin-schemas";
import {
  type AdminClassesTableChange,
  adminClassesTableState,
  hasAdminClassFilters,
  nextAdminClassesSearch,
  onlyClassSearchTextChanged,
} from "@/server/classes/admin-table-state";
import type { AdminClassRow } from "@/server/classes/queries";

/** The id of the class table's hidden-columns preference cookie. */
const TABLE_ID = "admin-classes";

/** Columns that exist only to carry a filter: never shown, never offered in "View". */
const FILTER_ONLY = { status: false, year: false, ownerNotTeacher: false } as const;

const LINK_CLASS =
  "w-fit font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const helper = createDataTableColumnHelper<AdminClassRow>();

/** The columns of the administrator's class list: no grades or results (R-01). */
const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    enableHiding: false,
    meta: { label: () => m.classes_col_class() },
    header: () => m.classes_col_class(),
    cell: ({ row }) => (
      <Link
        to="/admin/classes/$classId"
        params={{ classId: row.original.id }}
        className={LINK_CLASS}
      >
        <ClassName
          name={row.original.name}
          academicYear={row.original.academicYear}
          archived={row.original.archivedAt !== null}
        />
      </Link>
    ),
  }),
  helper.accessor((row) => (row.archivedAt === null ? "active" : "archived"), {
    id: "status",
    enableHiding: false,
    meta: { label: () => m.classes_admin_filter_status() },
    header: () => m.classes_admin_filter_status(),
  }),
  helper.display({
    id: "ownerNotTeacher",
    enableHiding: false,
    meta: { label: () => m.classes_admin_filter_owner_not_teacher() },
    header: () => m.classes_admin_filter_owner_not_teacher(),
  }),
  helper.accessor("academicYear", {
    id: "year",
    enableHiding: false,
    meta: { label: () => m.classes_field_year() },
    header: () => m.classes_field_year(),
  }),
  helper.accessor((row) => row.owner?.id ?? "", {
    id: "owner",
    meta: { label: () => m.classes_col_owner() },
    header: () => m.classes_col_owner(),
    cell: ({ row }) =>
      row.original.owner?.name ?? (
        <span className="text-muted-foreground">{m.classes_no_owner()}</span>
      ),
  }),
  helper.accessor((row) => row.coTeachers.map((teacher) => teacher.name).join(", "), {
    id: "coTeachers",
    meta: { label: () => m.classes_col_co_teachers() },
    header: () => m.classes_col_co_teachers(),
    cell: ({ row }) =>
      row.original.coTeachers.length === 0 ? (
        <span className="text-muted-foreground">{m.classes_none()}</span>
      ) : (
        <ul className="flex flex-col">
          {row.original.coTeachers.map((teacher) => (
            <li key={teacher.id}>{teacher.name}</li>
          ))}
        </ul>
      ),
  }),
  helper.accessor("students", {
    id: "students",
    meta: { label: () => m.classes_col_students(), className: "text-right" },
    header: () => m.classes_col_students(),
    cell: ({ getValue }) => formatNumber(getValue()),
  }),
  helper.accessor("pendingInvitations", {
    id: "pendingInvitations",
    meta: { label: () => m.classes_col_pending(), className: "text-right" },
    header: () => m.classes_col_pending(),
    cell: ({ getValue }) => formatNumber(getValue()),
  }),
]);

const STATUS_ICONS = {
  active: CircleCheckIcon,
  archived: ArchiveIcon,
} as const satisfies Record<AdminClassStatus, unknown>;

function statusLabel(status: AdminClassStatus): string {
  return status === "archived" ? m.classes_filter_archived() : m.classes_filter_active();
}

/** Why the list is empty: nothing at all, no active class (the default), or no match. */
type EmptyKind = "none" | "no_active" | "filtered";

function emptyText(kind: EmptyKind): { title: string; body: string } {
  switch (kind) {
    case "filtered":
      return {
        title: m.classes_admin_empty_filtered(),
        body: m.classes_admin_empty_filtered_body(),
      };
    case "no_active":
      return { title: m.classes_admin_empty_active(), body: m.classes_admin_empty_active_body() };
    case "none":
      return { title: m.classes_admin_empty(), body: m.classes_admin_empty_body() };
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

function ClassesEmpty({ kind }: Readonly<{ kind: EmptyKind }>) {
  const text = emptyText(kind);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SchoolIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{text.title}</h2>
        </EmptyTitle>
        <EmptyDescription>{text.body}</EmptyDescription>
      </EmptyHeader>
      {kind !== "none" && (
        <EmptyContent>
          <Button variant="outline" asChild>
            {kind === "filtered" ? (
              <Link to="/admin/classes" search={{}}>
                {m.classes_admin_clear_filters()}
              </Link>
            ) : (
              <Link to="/admin/classes" search={{ status: ["archived"] }}>
                {m.classes_admin_show_archived()}
              </Link>
            )}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * Every class for the administrator (#37) on the reusable data table: search, the archive,
 * academic-year and owner facets with server counts, and pagination, all processed on the server
 * and held in the URL. The order is fixed: academic year (newest first), then name.
 */
export function AdminClassesTable({
  page,
  search,
  fetching,
}: Readonly<{ page: AdminClassesPage; search: AdminClassListSearch; fetching: boolean }>) {
  const navigate = useNavigate({ from: "/admin/classes/" });
  const state = useMemo(() => adminClassesTableState(search), [search]);
  const [hidden, setHidden] = useState(() => readHiddenColumns(TABLE_ID));
  const columnVisibility = useMemo(
    () => ({ ...visibilityFromHidden(hidden), ...FILTER_ONLY }),
    [hidden],
  );

  function change(update: AdminClassesTableChange) {
    const next = nextAdminClassesSearch(search, update);
    void navigate({ search: next, replace: onlyClassSearchTextChanged(search, next) });
  }

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: page.rows,
    rowCount: page.total,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
    state: { ...state, columnVisibility },
    onColumnFiltersChange: (updater) =>
      change({ columnFilters: functionalUpdate(updater, state.columnFilters) }),
    onPaginationChange: (updater) =>
      change({ pagination: functionalUpdate(updater, state.pagination) }),
    onColumnVisibilityChange: (updater) => {
      const visible = functionalUpdate(updater, columnVisibility);
      const next = hiddenFromVisibility(visible).filter((id) => !(id in FILTER_ONLY));
      setHidden(next);
      // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
      document.cookie = hiddenColumnsCookie(TABLE_ID, next, window.location.protocol === "https:");
    },
  });

  const status = table.getColumn("status");
  const year = table.getColumn("year");
  const owner = table.getColumn("owner");
  const ownerNotTeacher = table.getColumn("ownerNotTeacher");
  const onlyOwnerNotTeacher = search.ownerNotTeacher === true;
  const pages = Math.max(1, table.getPageCount());
  const yearCounts = Object.fromEntries(
    page.facets.year.map((value) => [value.value, value.count]),
  );
  const ownerCounts = Object.fromEntries(
    page.facets.owner.map((value) => [value.value, value.count]),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DataTableToolbar
        table={table}
        search={{
          columnId: "name",
          label: m.classes_admin_search_label(),
          maxLength: ADMIN_CLASS_SEARCH_MAX,
          shortcut: true,
        }}
      >
        {status && (
          <DataTableFacetedFilter
            column={status}
            title={m.classes_admin_filter_status()}
            options={ADMIN_CLASS_STATUSES.map((value) => ({
              value,
              label: statusLabel(value),
              icon: STATUS_ICONS[value],
            }))}
            counts={page.facets.status}
          />
        )}
        {year && (
          <DataTableFacetedFilter
            column={year}
            title={m.classes_field_year()}
            options={page.facets.year.map((value) => ({
              value: value.value,
              label: displayYear(value.label),
            }))}
            counts={yearCounts}
          />
        )}
        {owner && (
          <DataTableFacetedFilter
            column={owner}
            title={m.classes_col_owner()}
            options={page.facets.owner.map((value) => ({ value: value.value, label: value.label }))}
            counts={ownerCounts}
          />
        )}
        {ownerNotTeacher && (
          <Button
            variant={onlyOwnerNotTeacher ? "secondary" : "outline"}
            size="sm"
            className="border-dashed"
            aria-pressed={onlyOwnerNotTeacher}
            onClick={() => ownerNotTeacher.setFilterValue(onlyOwnerNotTeacher ? undefined : true)}
          >
            <ShieldAlertIcon aria-hidden="true" data-icon="inline-start" />
            {m.classes_admin_filter_owner_not_teacher_count({
              count: formatNumber(page.facets.ownerNotTeacher),
            })}
          </Button>
        )}
      </DataTableToolbar>
      <p role="status" className="sr-only">
        {m.classes_admin_results({ total: formatNumber(page.total) })}
      </p>
      <DataTable
        table={table}
        caption={m.classes_admin_caption_page({
          page: formatNumber(state.pagination.pageIndex + 1),
          pages: formatNumber(pages),
        })}
        busy={fetching}
        fill
        empty={
          <ClassesEmpty
            kind={
              hasAdminClassFilters(search)
                ? "filtered"
                : page.facets.status.archived > 0
                  ? "no_active"
                  : "none"
            }
          />
        }
      />
      <DataTablePagination
        table={table}
        label={m.classes_admin_pagination()}
        pageSizes={ADMIN_CLASS_PAGE_SIZES}
        range={(range) => m.classes_admin_range(range)}
      />
    </div>
  );
}
