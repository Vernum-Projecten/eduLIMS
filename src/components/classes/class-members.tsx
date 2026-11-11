// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTable } from "@tanstack/react-table";
import { CrownIcon, UserMinusIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { useClassMutation } from "@/components/classes/use-class-mutation";
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
import { type ClassRole, classCan, memberPermission } from "@/lib/classes";
import { classRoleLabel } from "@/lib/i18n/class-labels";
import { removeMemberFn, transferOwnershipFn } from "@/server/classes/functions";
import type { ClassMemberView } from "@/server/classes/queries";
import { type ClassPage, classMutationOptions } from "@/server/classes/query-options";

/** The actions on one member that the viewer's class role allows. */
function MemberActions({
  classId,
  member,
  myRole,
  archived,
}: Readonly<{ classId: string; member: ClassMemberView; myRole: ClassRole; archived: boolean }>) {
  const queryClient = useQueryClient();
  const remove = useClassMutation(
    classMutationOptions(queryClient, useServerFn(removeMemberFn)),
    () => m.classes_member_removed({ name: member.name }),
  );
  const transfer = useClassMutation(
    classMutationOptions(queryClient, useServerFn(transferOwnershipFn)),
    () => m.classes_owner_changed({ name: member.name }),
  );
  if (archived || member.role === "owner") return null;
  const canRemove = classCan(myRole, memberPermission(member.role, "remove"));
  const canTransfer = member.role === "teacher" && classCan(myRole, { class: ["transfer"] });
  if (!canRemove && !canTransfer) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {canTransfer && (
        <ConfirmButton
          icon={CrownIcon}
          label={m.classes_transfer({ name: member.name })}
          title={m.classes_transfer_title({ name: member.name })}
          description={m.classes_transfer_description({ name: member.name })}
          confirm={m.classes_transfer_confirm()}
          pending={transfer.isPending}
          onConfirm={() => transfer.mutate({ classId, userId: member.userId })}
        />
      )}
      {canRemove && (
        <ConfirmButton
          icon={UserMinusIcon}
          label={m.classes_remove({ name: member.name })}
          title={m.classes_remove_title({ name: member.name })}
          description={m.classes_remove_description()}
          confirm={m.classes_remove_confirm()}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ classId, userId: member.userId })}
        />
      )}
    </div>
  );
}

const helper = createDataTableColumnHelper<ClassMemberView>();

/** The members of a class (#28): owner, co-teachers and students, with what the viewer may do. */
export function ClassMembers({ page }: Readonly<{ page: ClassPage }>) {
  const archived = page.archivedAt !== null;
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          id: "name",
          meta: { label: () => m.classes_col_name() },
          header: () => m.classes_col_name(),
          cell: ({ row }) => (
            <div className="flex min-w-40 flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-muted-foreground break-all">{row.original.email}</span>
            </div>
          ),
        }),
        helper.accessor("role", {
          id: "role",
          meta: { label: () => m.classes_col_role() },
          header: () => m.classes_col_role(),
          cell: ({ getValue }) => (
            <Badge variant={getValue() === "student" ? "outline" : "secondary"}>
              {classRoleLabel(getValue())}
            </Badge>
          ),
        }),
        helper.display({
          id: "actions",
          meta: { label: () => m.classes_col_actions(), className: "text-right" },
          header: () => <span className="sr-only">{m.classes_col_actions()}</span>,
          cell: ({ row }) => (
            <MemberActions
              classId={page.id}
              member={row.original}
              myRole={page.myRole}
              archived={archived}
            />
          ),
        }),
      ]),
    [page.id, page.myRole, archived],
  );
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: page.members,
    rowCount: page.members.length,
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
      caption={m.classes_members_caption()}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h3>{m.classes_members_empty()}</h3>
            </EmptyTitle>
            <EmptyDescription>{m.classes_members_empty_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
    />
  );
}
