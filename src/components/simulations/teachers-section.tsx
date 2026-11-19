// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { UserMinusIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { useAppForm } from "@/components/form/app-form";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog } from "@/components/simulations/confirm-dialog";
import { focusById } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { EMAIL_LINE_MAX } from "@/lib/simulations";
import { addTeacherFn, removeTeacherFn } from "@/server/simulations/functions";
import type { TeacherSimulationPage } from "@/server/simulations/queries";
import {
  deleteMutationOptions,
  simulationErrorCode,
  simulationMutationOptions,
} from "@/server/simulations/query-options";
import { type AddTeacherForm, addTeacherFormSchema } from "@/server/simulations/schemas";

const TEACHERS_HEADING = "teachers-heading";

/** A teacher row with what its remove action needs. */
interface TeacherRow {
  simulationId: string;
  userId: string;
  name: string;
  email: string;
  self: boolean;
}

const helper = createDataTableColumnHelper<TeacherRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.simulations_col_teacher_name(),
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        {row.original.self && <Badge variant="secondary">{m.simulations_teacher_you()}</Badge>}
      </span>
    ),
  }),
  helper.accessor("email", {
    id: "email",
    header: () => m.simulations_col_email(),
    cell: ({ row }) => <span className="break-all">{row.original.email}</span>,
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <RemoveTeacher teacher={row.original} />,
  }),
]);

/**
 * The teachers of a simulation (D10: "with the same rights"): add one by the address of their
 * teacher account, remove one behind a confirmation. The server keeps the last teacher.
 */
export function TeachersSection({
  page,
  userId,
  busy,
}: Readonly<{ page: TeacherSimulationPage; userId: string; busy: boolean }>) {
  const rows = useMemo(
    () =>
      page.teachers.map((teacher) => ({
        ...teacher,
        simulationId: page.id,
        self: teacher.userId === userId,
      })),
    [page.teachers, page.id, userId],
  );
  return (
    <section aria-labelledby={TEACHERS_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={TEACHERS_HEADING} tabIndex={-1} className="text-lg font-semibold outline-none">
          {m.simulations_teachers_heading()}
        </h2>
        <p className="text-muted-foreground">{m.simulations_teachers_description()}</p>
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.userId}
        caption={m.simulations_teachers_caption({ simulation: page.name })}
        busy={busy}
        empty={null}
      />
      <AddTeacher simulationId={page.id} />
    </section>
  );
}

function AddTeacher({ simulationId }: Readonly<{ simulationId: string }>) {
  const queryClient = useQueryClient();
  const call = useServerFn(addTeacherFn);
  const add = useSimulationAction(
    simulationMutationOptions(queryClient, call, simulationActionKeys.addTeacher(simulationId)),
    {
      success: (_value, data) => m.simulations_teacher_added({ email: data.email }),
      toastErrors: false,
    },
  );
  const form = useAppForm({
    defaultValues: { email: "" } satisfies AddTeacherForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: addTeacherFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await add.mutateAsync({ ...addTeacherFormSchema.parse(value), simulationId });
      } catch (error) {
        const code = simulationErrorCode(error);
        const atField =
          code === "not_a_teacher" || code === "already_teacher" || code === "teacher_not_found";
        applyServerRefusal(
          formApi,
          atField
            ? { fields: { email: simulationErrorMessage(code) } }
            : { form: simulationErrorMessage(code) },
        );
        return;
      }
      formApi.reset();
    },
  });
  return (
    <form
      noValidate
      aria-label={m.simulations_teacher_add_form()}
      className="flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                type="email"
                label={m.simulations_teacher_email()}
                description={m.simulations_teacher_email_help()}
                maxLength={EMAIL_LINE_MAX}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </form.AppField>
        </FieldGroup>
        <div>
          <form.SubmitButton icon={<UserPlusIcon aria-hidden="true" data-icon="inline-start" />}>
            {m.simulations_teacher_add()}
          </form.SubmitButton>
        </div>
      </form.AppForm>
    </form>
  );
}

function RemoveTeacher({ teacher }: Readonly<{ teacher: TeacherRow }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const callRemove = useServerFn(removeTeacherFn);
  const remove = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callRemove,
      simulationActionKeys.removeTeacher(teacher.simulationId),
    ),
    {
      success: () => m.simulations_teacher_removed({ name: teacher.name }),
      onDone: () => focusById(TEACHERS_HEADING),
    },
  );
  const leaveKeys = simulationActionKeys.leaveSimulation(teacher.simulationId);
  const leave = useSimulationAction(
    deleteMutationOptions(queryClient, callRemove, leaveKeys.removed, leaveKeys.invalidates, () =>
      navigate({ to: "/teacher/simulations" }),
    ),
    { success: () => m.simulations_left() },
  );
  const label = teacher.self
    ? m.simulations_leave()
    : m.simulations_teacher_remove({ name: teacher.name });
  const input = { simulationId: teacher.simulationId, userId: teacher.userId };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled={remove.isPending || leave.isPending}
        onClick={() => setOpen(true)}
      >
        <UserMinusIcon aria-hidden="true" />
      </Button>
      <ConfirmDialog
        control={{ open, onOpenChange: setOpen }}
        title={
          teacher.self
            ? m.simulations_leave_title()
            : m.simulations_teacher_remove_title({ name: teacher.name })
        }
        body={teacher.self ? m.simulations_leave_body() : m.simulations_teacher_remove_body()}
        confirm={
          teacher.self ? m.simulations_leave_confirm() : m.simulations_teacher_remove_confirm()
        }
        onConfirm={() => (teacher.self ? leave.mutate(input) : remove.mutate(input))}
      />
    </>
  );
}
