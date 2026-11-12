// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CopyIcon, PencilIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { useAppForm } from "@/components/form/app-form";
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
import { CLASS_NAME_MAX, nextAcademicYear } from "@/lib/classes";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { copyClassFn, createClassFn, updateClassFn } from "@/server/classes/functions";
import { classErrorCode, classMutationOptions } from "@/server/classes/query-options";
import {
  type ClassForm,
  type CopyClassForm,
  classFormSchema,
  copyClassFormSchema,
} from "@/server/classes/schemas";

/** A dialog with one form: its trigger, title, description, fields and submit label. */
function FormDialog({
  trigger,
  title,
  description,
  open,
  onOpenChange,
  children,
}: Readonly<{
  trigger: ReactNode;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The name and academic-year fields with the form's submit, shared by create and edit. */
function ClassFormBody({
  defaultValues,
  submit,
  onSubmit,
}: Readonly<{
  defaultValues: ClassForm;
  submit: string;
  onSubmit: (value: ClassForm) => Promise<string | null>;
}>) {
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: classFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const refusal = await onSubmit(value);
      if (refusal) applyServerRefusal(formApi, { form: refusal });
    },
  });
  return (
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
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {m.classes_cancel()}
            </Button>
          </DialogClose>
          <form.SubmitButton>{submit}</form.SubmitButton>
        </DialogFooter>
      </form.AppForm>
    </form>
  );
}

/** "New class": creates a class owned by the teacher and opens its page (#28). */
export function CreateClassDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useClassMutation(
    classMutationOptions(queryClient, useServerFn(createClassFn)),
    (_data, variables) => m.classes_created({ name: variables.name.trim() }),
    { inForm: true },
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={m.classes_create_title()}
      description={m.classes_create_description()}
      trigger={
        <Button>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_create()}
        </Button>
      }
    >
      <ClassFormBody
        defaultValues={{ name: "", academicYear: "" }}
        submit={m.classes_create_submit()}
        onSubmit={async (value) => {
          try {
            const { classId } = await create.mutateAsync(value);
            setOpen(false);
            await navigate({ to: "/teacher/classes/$classId", params: { classId } });
            return null;
          } catch (error) {
            return classErrorMessage(classErrorCode(error));
          }
        }}
      />
    </FormDialog>
  );
}

/** "Edit": renames the class or changes its academic year (the owner only). */
export function EditClassDialog({
  classId,
  name,
  academicYear,
}: Readonly<{ classId: string; name: string; academicYear: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const update = useClassMutation(
    classMutationOptions(queryClient, useServerFn(updateClassFn)),
    () => m.classes_updated(),
    { inForm: true },
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={m.classes_edit_title()}
      description={m.classes_edit_description()}
      trigger={
        <Button variant="outline" size="sm">
          <PencilIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_edit()}
        </Button>
      }
    >
      <ClassFormBody
        defaultValues={{ name, academicYear }}
        submit={m.classes_save()}
        onSubmit={async (value) => {
          try {
            await update.mutateAsync({ classId, ...value });
            setOpen(false);
            return null;
          } catch (error) {
            return classErrorMessage(classErrorCode(error));
          }
        }}
      />
    </FormDialog>
  );
}

/**
 * "Copy to a new year" (#28): the same name, the new academic year, the same co-teachers and
 * group sets, without students. Opens the copy.
 */
export function CopyClassDialog({
  classId,
  academicYear,
}: Readonly<{ classId: string; academicYear: string }>) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = useClassMutation(
    classMutationOptions(queryClient, useServerFn(copyClassFn)),
    () => m.classes_copied(),
    { inForm: true },
  );
  const form = useAppForm({
    defaultValues: { academicYear: nextAcademicYear(academicYear) } satisfies CopyClassForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: copyClassFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const copied = await copy.mutateAsync({ classId, ...value });
        setOpen(false);
        await navigate({ to: "/teacher/classes/$classId", params: { classId: copied.classId } });
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={m.classes_copy_title()}
      description={m.classes_copy_description()}
      trigger={
        <Button variant="outline" size="sm">
          <CopyIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_copy()}
        </Button>
      }
    >
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
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {m.classes_cancel()}
              </Button>
            </DialogClose>
            <form.SubmitButton>{m.classes_copy_submit()}</form.SubmitButton>
          </DialogFooter>
        </form.AppForm>
      </form>
    </FormDialog>
  );
}
