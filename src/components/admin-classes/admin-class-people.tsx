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
import { formatDate } from "@/lib/i18n/format";
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

/** The members of a class for the administrator: names and class roles only (R-01). */
export function AdminClassMembers({ members }: Readonly<{ members: AdminClassMember[] }>) {
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
  return (
    <DataTable
      table={table}
      caption={m.classes_admin_members_caption()}
      empty={
        <EmptyList
          icon={<UsersIcon aria-hidden="true" />}
          title={m.classes_admin_members_empty()}
          body={m.classes_admin_members_empty_body()}
        />
      }
    />
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
