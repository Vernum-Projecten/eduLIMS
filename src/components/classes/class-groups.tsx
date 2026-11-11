// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2Icon, UsersRoundIcon } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import {
  AutoSplitDialog,
  CopyGroupSetDialog,
  CreateGroupsDialog,
  RenameGroupDialog,
} from "@/components/classes/group-dialogs";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { classCan } from "@/lib/classes";
import { formatNumber } from "@/lib/i18n/format";
import { deleteGroupFn, moveStudentFn } from "@/server/classes/functions";
import type { GroupView } from "@/server/classes/queries";
import { type ClassPage, classMutationOptions } from "@/server/classes/query-options";

/** The group of each student in a set, by user id. */
function placesIn(groups: readonly GroupView[]): Map<string, string> {
  const places = new Map<string, string>();
  for (const group of groups) for (const id of group.memberIds) places.set(id, group.id);
  return places;
}

/** One group: its name, its students, and rename and delete for a teacher. */
function GroupCard({
  page,
  group,
  names,
  editable,
}: Readonly<{
  page: ClassPage;
  group: GroupView;
  names: ReadonlyMap<string, string>;
  editable: boolean;
}>) {
  const queryClient = useQueryClient();
  const remove = useClassMutation(
    classMutationOptions(queryClient, useServerFn(deleteGroupFn)),
    () => m.classes_group_deleted({ name: group.name }),
  );
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId} role="group">
      <CardHeader>
        <CardTitle>
          <h4 id={titleId}>{group.name}</h4>
        </CardTitle>
        <CardAction className="text-muted-foreground text-sm">
          {m.classes_group_size({ count: formatNumber(group.memberIds.length) })}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {group.memberIds.length === 0 ? (
          <p className="text-muted-foreground">{m.classes_group_empty()}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {group.memberIds.map((id) => (
              <li key={id}>{names.get(id) ?? id}</li>
            ))}
          </ul>
        )}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <RenameGroupDialog classId={page.id} groupId={group.id} name={group.name} />
            <ConfirmButton
              icon={Trash2Icon}
              label={m.classes_group_delete({ name: group.name })}
              title={m.classes_group_delete_title({ name: group.name })}
              description={m.classes_group_delete_description()}
              confirm={m.classes_group_delete_confirm()}
              destructive
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ classId: page.id, groupId: group.id })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The students of the class with a group picker each: moving is a keyboard-operable select. */
function StudentPlaces({
  page,
  groupSet,
  groups,
  editable,
}: Readonly<{
  page: ClassPage;
  groupSet: string;
  groups: readonly GroupView[];
  editable: boolean;
}>) {
  const queryClient = useQueryClient();
  const move = useClassMutation(classMutationOptions(queryClient, useServerFn(moveStudentFn)), () =>
    m.classes_student_moved(),
  );
  const places = placesIn(groups);
  const students = page.members.filter((member) => member.role === "student");
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  if (students.length === 0) {
    return <p className="text-muted-foreground">{m.classes_groups_no_students()}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableCaption className="sr-only">
          {m.classes_groups_students_caption({ set: groupSet })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{m.classes_col_student()}</TableHead>
            <TableHead scope="col">{m.classes_col_group()}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => {
            const current = places.get(student.userId) ?? "";
            return (
              <TableRow key={student.userId}>
                <TableCell className="font-medium">{student.name}</TableCell>
                <TableCell>
                  {editable ? (
                    <NativeSelect
                      aria-label={m.classes_group_of({ name: student.name })}
                      value={current}
                      disabled={move.isPending}
                      onChange={(event) =>
                        move.mutate({
                          classId: page.id,
                          userId: student.userId,
                          groupSet,
                          groupId: event.target.value === "" ? null : event.target.value,
                        })
                      }
                    >
                      <NativeSelectOption value="">{m.classes_no_group()}</NativeSelectOption>
                      {groups.map((group) => (
                        <NativeSelectOption key={group.id} value={group.id}>
                          {group.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  ) : (
                    (groupName.get(current) ?? m.classes_no_group())
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The lab groups tab (#28): group sets, their groups and each student's group. Teachers of the
 * class manage them; an archived class shows them read-only.
 */
export function ClassGroups({ page }: Readonly<{ page: ClassPage }>) {
  const editable = page.archivedAt === null && classCan(page.myRole, { group: ["manage"] });
  const [picked, setPicked] = useState("");
  const groupSet = page.groupSets.includes(picked) ? picked : (page.groupSets[0] ?? "");
  const groups = page.groups.filter((group) => group.groupSet === groupSet);
  const names = new Map(page.members.map((member) => [member.userId, member.name]));
  const selectId = useId();
  const takenNames = (set: string) =>
    page.groups.filter((group) => group.groupSet === set).map((group) => group.name);
  const tools = editable && (
    <div className="flex flex-wrap gap-2">
      <CreateGroupsDialog classId={page.id} groupSet={groupSet} takenNames={takenNames} />
      <AutoSplitDialog classId={page.id} />
      <CopyGroupSetDialog classId={page.id} />
    </div>
  );
  if (page.groupSets.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h3>{m.classes_groups_empty()}</h3>
          </EmptyTitle>
          <EmptyDescription>
            {editable ? m.classes_groups_empty_body() : m.classes_groups_empty_read_only()}
          </EmptyDescription>
        </EmptyHeader>
        {tools && <EmptyContent>{tools}</EmptyContent>}
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Field className="sm:max-w-xs">
          <FieldLabel htmlFor={selectId}>{m.classes_field_group_set()}</FieldLabel>
          <NativeSelect
            id={selectId}
            value={groupSet}
            onChange={(event) => setPicked(event.target.value)}
          >
            {page.groupSets.map((set) => (
              <NativeSelectOption key={set} value={set}>
                {set}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {tools}
      </div>
      <section aria-labelledby="groups-heading" className="flex flex-col gap-4">
        <h3 id="groups-heading" className="text-lg font-semibold">
          {m.classes_groups_in_set({ set: groupSet })}
        </h3>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <li key={group.id}>
              <GroupCard page={page} group={group} names={names} editable={editable} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="places-heading" className="flex flex-col gap-4">
        <h3 id="places-heading" className="text-lg font-semibold">
          {m.classes_groups_students()}
        </h3>
        <StudentPlaces page={page} groupSet={groupSet} groups={groups} editable={editable} />
      </section>
    </div>
  );
}
