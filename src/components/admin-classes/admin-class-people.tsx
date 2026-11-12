// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useTable } from "@tanstack/react-table";
import { CircleAlertIcon, MailIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { classRoleLabel } from "@/lib/i18n/class-labels";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { AdminClassInvitation, AdminClassMember } from "@/server/classes/admin-queries";

function EmptyList({
  icon,
  title,
  body,
}: Readonly<{ icon: ReactNode; title: string; body: string }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>
          <h3>{title}</h3>
        </EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const memberHelper = createDataTableColumnHelper<AdminClassMember>();

const memberColumns = memberHelper.columns([
  memberHelper.accessor("name", {
    id: "name",
    meta: { label: () => m.classes_col_name() },
    header: () => m.classes_col_name(),
  }),
  memberHelper.accessor("role", {
    id: "role",
    meta: { label: () => m.classes_col_role() },
    header: () => m.classes_col_role(),
    cell: ({ getValue }) => classRoleLabel(getValue()),
  }),
]);

/** One list of a class's members for the administrator: names and class roles only (R-01). */
function MembersTable({
  members,
  caption,
  empty,
}: Readonly<{ members: AdminClassMember[]; caption: string; empty: ReactNode }>) {
  const table = useTable({
    features: dataTableFeatures,
    columns: memberColumns,
    data: members,
    rowCount: members.length,
    getRowId: (row) => row.userId,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
  });
  return <DataTable table={table} caption={caption} empty={empty} />;
}

/**
 * The members of a class for the administrator in two lists, each under its own `h2`: the
 * teachers (owner and co-teachers, with their class role) and the students (R-01).
 */
export function AdminClassMembers({ members }: Readonly<{ members: AdminClassMember[] }>) {
  const teachers = members.filter((member) => member.role !== "student");
  const students = members.filter((member) => member.role === "student");
  return (
    <>
      <section aria-labelledby="admin-class-teachers-heading" className="flex flex-col gap-4">
        <h2 id="admin-class-teachers-heading" className="text-lg font-semibold">
          {m.classes_members_teachers_title({ count: formatNumber(teachers.length) })}
        </h2>
        <MembersTable
          members={teachers}
          caption={m.classes_members_teachers_caption()}
          empty={
            <EmptyList
              icon={<UsersIcon aria-hidden="true" />}
              title={m.classes_admin_members_empty()}
              body={m.classes_admin_members_empty_body()}
            />
          }
        />
      </section>
      <section aria-labelledby="admin-class-students-heading" className="flex flex-col gap-4">
        <h2 id="admin-class-students-heading" className="text-lg font-semibold">
          {m.classes_members_students_title({ count: formatNumber(students.length) })}
        </h2>
        <MembersTable
          members={students}
          caption={m.classes_members_students_caption()}
          empty={
            <EmptyList
              icon={<UsersIcon aria-hidden="true" />}
              title={m.classes_members_students_empty()}
              body={m.classes_admin_students_empty_body()}
            />
          }
        />
      </section>
    </>
  );
}

const invitationHelper = createDataTableColumnHelper<AdminClassInvitation>();

const invitationColumns = invitationHelper.columns([
  invitationHelper.accessor("email", {
    id: "email",
    meta: { label: () => m.classes_col_email() },
    header: () => m.classes_col_email(),
    cell: ({ getValue }) => <span className="break-all">{getValue()}</span>,
  }),
  invitationHelper.accessor("role", {
    id: "role",
    meta: { label: () => m.classes_col_role() },
    header: () => m.classes_col_role(),
    cell: ({ getValue }) => classRoleLabel(getValue()),
  }),
  invitationHelper.accessor("expiresAt", {
    id: "expiresAt",
    meta: { label: () => m.classes_col_expires() },
    header: () => m.classes_col_expires(),
    cell: ({ row }) =>
      row.original.expired ? (
        <Badge variant="outline">
          <CircleAlertIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_invitation_expired()}
        </Badge>
      ) : (
        <time dateTime={row.original.expiresAt}>{formatDate(row.original.expiresAt)}</time>
      ),
  }),
]);

/** The pending invitations of a class for the administrator, expired ones marked. */
export function AdminClassInvitations({
  invitations,
}: Readonly<{ invitations: AdminClassInvitation[] }>) {
  const table = useTable({
    features: dataTableFeatures,
    columns: invitationColumns,
    data: invitations,
    rowCount: invitations.length,
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
      caption={m.classes_invitations_caption()}
      empty={
        <EmptyList
          icon={<MailIcon aria-hidden="true" />}
          title={m.classes_invitations_empty()}
          body={m.classes_invitations_empty_body()}
        />
      }
    />
  );
}
