// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon, UserRoundCogIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { useAppForm } from "@/components/form/app-form";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { CLASS_NAME_MAX } from "@/lib/classes";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import {
  adminArchiveClassFn,
  adminCreateClassFn,
  adminTransferOwnershipFn,
  adminUnarchiveClassFn,
} from "@/server/classes/admin-functions";
import type { TeacherCandidate } from "@/server/classes/admin-queries";
import {
  type AdminClassPageData,
  teacherCandidatesQueryOptions,
} from "@/server/classes/admin-query-options";
import {
  type AdminClassForm,
  adminClassFormSchema,
  type TransferForm,
  transferFormSchema,
} from "@/server/classes/admin-schemas";
import { classErrorCode, classMutationOptions } from "@/server/classes/query-options";

/** The teachers as owner choices: the name with the address, since names repeat. */
function teacherOptions(teachers: readonly TeacherCandidate[], except?: string) {
  return teachers
    .filter((teacher) => teacher.id !== except)
    .map((teacher) => ({
      value: teacher.id,
      label: m.classes_admin_teacher_option({ name: teacher.name, email: teacher.email }),
    }));
}

/**
 * "New class" for the administrator (#37, B2): a class on a teacher's behalf, with that teacher
 * as its owner; the administrator does not become a member. Opens the new class.
 */
export function AdminCreateClassDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: teachers } = useSuspenseQuery(teacherCandidatesQueryOptions());
  const create = useClassMutation(
    classMutationOptions(queryClient, useServerFn(adminCreateClassFn)),
    (_data, variables) => m.classes_created({ name: variables.name.trim() }),
    { inForm: true },
  );
  const form = useAppForm({
    defaultValues: { name: "", academicYear: "", ownerId: "" } satisfies AdminClassForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: adminClassFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const { classId } = await create.mutateAsync(value);
        setOpen(false);
        formApi.reset();
        await navigate({ to: "/admin/classes/$classId", params: { classId } });
      } catch (error) {
        const code = classErrorCode(error);
        const message = classErrorMessage(code);
        applyServerRefusal(
          formApi,
          code === "not_a_teacher" ? { fields: { ownerId: message } } : { form: message },
        );
      }
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_create()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.classes_create_title()}</DialogTitle>
          <DialogDescription>{m.classes_admin_create_description()}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label={m.classes_field_name()}
                    description={m.classes_field_name_help()}
                    maxLength={CLASS_NAME_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="academicYear">
                {(field) => (
                  <field.TextField
                    label={m.classes_field_year()}
                    description={m.classes_field_year_help()}
                    inputMode="numeric"
                    maxLength={9}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="ownerId">
                {(field) => (
                  <field.SelectField
                    label={m.classes_admin_field_owner()}
                    description={m.classes_admin_field_owner_help()}
                    placeholder={m.classes_admin_field_owner_placeholder()}
                    options={teacherOptions(teachers)}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.classes_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton>{m.classes_create_submit()}</form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Transfer ownership" (#37): a destructive confirmation with the new owner, any user whose app
 * role includes teacher. The old owner stays as a co-teacher while they are a teacher.
 */
export function TransferOwnershipDialog({ page }: Readonly<{ page: AdminClassPageData }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: teachers } = useSuspenseQuery(teacherCandidatesQueryOptions());
  const transfer = useClassMutation(
    classMutationOptions(queryClient, useServerFn(adminTransferOwnershipFn)),
    () => m.classes_admin_transferred({ name: page.name }),
    { inForm: true },
  );
  const form = useAppForm({
    defaultValues: { userId: "" } satisfies TransferForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: transferFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await transfer.mutateAsync({ classId: page.id, userId: value.userId });
        setOpen(false);
        formApi.reset();
      } catch (error) {
        const code = classErrorCode(error);
        const message = classErrorMessage(code);
        applyServerRefusal(
          formApi,
          code === "not_a_teacher" || code === "already_owner"
            ? { fields: { userId: message } }
            : { form: message },
        );
      }
    },
  });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserRoundCogIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_admin_transfer()}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.classes_admin_transfer_title({ name: page.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {page.owner
              ? m.classes_admin_transfer_description({ owner: page.owner.name })
              : m.classes_admin_transfer_description_no_owner()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="userId">
                {(field) => (
                  <field.SelectField
                    label={m.classes_admin_field_new_owner()}
                    description={m.classes_admin_field_owner_help()}
                    placeholder={m.classes_admin_field_owner_placeholder()}
                    options={teacherOptions(teachers, page.owner?.id)}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{m.classes_cancel()}</AlertDialogCancel>
              <form.SubmitButton variant="destructive">
                {m.classes_admin_transfer_confirm()}
              </form.SubmitButton>
            </AlertDialogFooter>
          </form.AppForm>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Archive" (#37): a destructive confirmation; the class becomes read-only for everyone. */
export function AdminArchiveButton({ page }: Readonly<{ page: AdminClassPageData }>) {
  const queryClient = useQueryClient();
  const archive = useClassMutation(
    classMutationOptions(queryClient, useServerFn(adminArchiveClassFn)),
    () => m.classes_archived_done({ name: page.name }),
  );
  return (
    <ConfirmButton
      icon={ArchiveIcon}
      label={m.classes_archive()}
      title={m.classes_archive_title({ name: page.name })}
      description={m.classes_admin_archive_description()}
      confirm={m.classes_archive_confirm()}
      destructive
      pending={archive.isPending}
      onConfirm={() => archive.mutate({ classId: page.id })}
    />
  );
}

/** "Reopen" of an archived class (#37). */
export function AdminUnarchiveButton({ page }: Readonly<{ page: AdminClassPageData }>) {
  const queryClient = useQueryClient();
  const reopen = useClassMutation(
    classMutationOptions(queryClient, useServerFn(adminUnarchiveClassFn)),
    () => m.classes_unarchived_done({ name: page.name }),
  );
  return (
    <ConfirmButton
      icon={ArchiveRestoreIcon}
      label={m.classes_unarchive()}
      title={m.classes_unarchive_title({ name: page.name })}
      description={m.classes_unarchive_description()}
      confirm={m.classes_unarchive_confirm()}
      pending={reopen.isPending}
      onConfirm={() => reopen.mutate({ classId: page.id })}
    />
  );
}
