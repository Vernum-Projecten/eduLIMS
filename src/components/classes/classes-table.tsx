// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { ArchiveIcon, SchoolIcon } from "lucide-react";
import { ClassName } from "@/components/classes/class-name";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { classRoleLabel } from "@/lib/i18n/class-labels";
import { formatNumber } from "@/lib/i18n/format";
import type { TeacherClassRow } from "@/server/classes/queries";

const LINK_CLASS =
  "w-fit font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const teacherHelper = createDataTableColumnHelper<TeacherClassRow>();

/** The columns of the teacher's class list; the class links to its page. */
const teacherColumns = teacherHelper.columns([
  teacherHelper.accessor("name", {
    id: "name",
    meta: { label: () => m.classes_col_class() },
    header: () => m.classes_col_class(),
    cell: ({ row }) => (
      <Link
        to="/teacher/classes/$classId"
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
  teacherHelper.accessor("myRole", {
    id: "myRole",
    meta: { label: () => m.classes_col_my_role() },
    header: () => m.classes_col_my_role(),
    cell: ({ getValue }) => classRoleLabel(getValue()),
  }),
  teacherHelper.accessor("students", {
    id: "students",
    meta: { label: () => m.classes_col_students(), className: "text-right" },
    header: () => m.classes_col_students(),
    cell: ({ getValue }) => formatNumber(getValue()),
  }),
  teacherHelper.accessor("teachers", {
    id: "teachers",
    meta: { label: () => m.classes_col_teachers(), className: "text-right" },
    header: () => m.classes_col_teachers(),
    cell: ({ getValue }) => formatNumber(getValue()),
  }),
  teacherHelper.accessor("pendingInvitations", {
    id: "pendingInvitations",
    meta: { label: () => m.classes_col_pending(), className: "text-right" },
    header: () => m.classes_col_pending(),
    cell: ({ getValue }) => formatNumber(getValue()),
  }),
]);

function ClassesEmpty({ archived }: Readonly<{ archived: boolean }>) {
  const Icon = archived ? ArchiveIcon : SchoolIcon;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{archived ? m.classes_empty_archived() : m.classes_empty()}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {archived ? m.classes_empty_archived_body() : m.classes_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The teacher's classes (#28) on the reusable data table: the server filters by membership and
 * archive state and orders by academic year, then name; a teacher has few classes, so there is
 * one page.
 */
export function ClassesTable({
  rows,
  archived,
  busy,
}: Readonly<{ rows: TeacherClassRow[]; archived: boolean; busy: boolean }>) {
  const table = useTable({
    features: dataTableFeatures,
    columns: teacherColumns,
    data: rows,
    rowCount: rows.length,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
  });
  return (
    <DataTable
      table={table}
      caption={archived ? m.classes_caption_archived() : m.classes_caption()}
      busy={busy}
      empty={<ClassesEmpty archived={archived} />}
    />
  );
}
