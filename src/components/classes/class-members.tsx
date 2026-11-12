// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTable } from "@tanstack/react-table";
import { CrownIcon, UserMinusIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import { type RowAction, RowActionMenu } from "@/components/data-table/row-action-menu";
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
import { formatNumber } from "@/lib/i18n/format";
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
  const input = { classId, userId: member.userId };
  const actions: RowAction[] = [];
  if (canTransfer) {
    actions.push({
      id: "transfer",
      icon: CrownIcon,
      label: m.classes_transfer_short(),
      accessibleName: m.classes_transfer({ name: member.name }),
      pending: transfer.isPending,
      confirmation: {
        title: m.classes_transfer_title({ name: member.name }),
        description: m.classes_transfer_description({ name: member.name }),
        confirm: m.classes_transfer_confirm(),
      },
      onRun: () => transfer.mutate(input),
    });
  }
  if (canRemove) {
    actions.push({
      id: "remove",
      icon: UserMinusIcon,
      label: m.classes_remove_confirm(),
      accessibleName: m.classes_remove({ name: member.name }),
      destructive: true,
      pending: remove.isPending,
      confirmation: {
        title: m.classes_remove_title({ name: member.name }),
        description: m.classes_remove_description(),
        confirm: m.classes_remove_confirm(),
      },
      onRun: () => remove.mutate(input),
    });
  }
  return <RowActionMenu name={member.name} actions={actions} />;
}

const helper = createDataTableColumnHelper<ClassMemberView>();

/** One list of members: the teachers (owner and co-teachers, with their class role) or the students. */
function MembersTable({
  page,
  members,
  caption,
  showRole,
  empty,
}: Readonly<{
  page: ClassPage;
  members: ClassMemberView[];
  caption: string;
  showRole: boolean;
  empty: ReactNode;
}>) {
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
        ...(showRole
          ? [
              helper.accessor("role", {
                id: "role",
                meta: { label: () => m.classes_col_role() },
                header: () => m.classes_col_role(),
                cell: ({ getValue }) => (
                  <Badge variant="secondary">{classRoleLabel(getValue())}</Badge>
                ),
              }),
            ]
          : []),
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
    [page.id, page.myRole, archived, showRole],
  );
  const table = useTable({
    features: dataTableFeatures,
    columns,
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

function MembersEmpty({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h3>{title}</h3>
        </EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The members of a class (#28) in two lists: the teachers (owner and co-teachers) and the
 * students, each with what the viewer may do.
 */
export function ClassMembers({ page }: Readonly<{ page: ClassPage }>) {
  const teachers = page.members.filter((member) => member.role !== "student");
  const students = page.members.filter((member) => member.role === "student");
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="class-teachers-heading" className="flex flex-col gap-3">
        <h2 id="class-teachers-heading" className="text-lg font-semibold">
          {m.classes_members_teachers_title({ count: formatNumber(teachers.length) })}
        </h2>
        <MembersTable
          page={page}
          members={teachers}
          caption={m.classes_members_teachers_caption()}
          showRole
          empty={
            <MembersEmpty title={m.classes_members_empty()} body={m.classes_members_empty_body()} />
          }
        />
      </section>
      <section aria-labelledby="class-students-heading" className="flex flex-col gap-3">
        <h2 id="class-students-heading" className="text-lg font-semibold">
          {m.classes_members_students_title({ count: formatNumber(students.length) })}
        </h2>
        <MembersTable
          page={page}
          members={students}
          caption={m.classes_members_students_caption()}
          showRole={false}
          empty={
            <MembersEmpty
              title={m.classes_members_students_empty()}
              body={m.classes_members_students_empty_body()}
            />
          }
        />
      </section>
    </div>
  );
}
