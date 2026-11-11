// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CopyIcon, PencilIcon, PlusIcon, ShuffleIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { classLabel } from "@/components/classes/class-name";
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
import { GROUP_NAME_MAX } from "@/lib/classes";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { formatNumber } from "@/lib/i18n/format";
import {
  autoSplitFn,
  copyGroupSetFn,
  createGroupsFn,
  renameGroupFn,
} from "@/server/classes/functions";
import {
  classErrorCode,
  classMutationOptions,
  groupSetSourcesQueryOptions,
} from "@/server/classes/query-options";
import {
  type AutoSplitForm,
  autoSplitFormSchema,
  type CopyGroupSetForm,
  type CreateGroupsForm,
  copyGroupSetFormSchema,
  createGroupsFormSchema,
  GROUP_SIZE_MAX,
  GROUPS_MAX,
  type RenameGroupForm,
  renameGroupFormSchema,
} from "@/server/classes/schemas";

/** A dialog around one form, opened by its own trigger button. */
function GroupDialog({
  label,
  icon,
  title,
  description,
  open,
  onOpenChange,
  size = "sm",
  children,
}: Readonly<{
  label: string;
  icon: ReactNode;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "default";
  children: ReactNode;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size={size}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
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

function Footer({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="outline">
          {m.classes_cancel()}
        </Button>
      </DialogClose>
      {children}
    </DialogFooter>
  );
}

/** Returns the names `<prefix> 1` to `<prefix> count`, skipping names already in the set. */
export function nextGroupNames(prefix: string, count: number, taken: readonly string[]): string[] {
  const held = new Set(taken);
  const names: string[] = [];
  for (let index = 1; names.length < count; index += 1) {
    const name = `${prefix.trim()} ${index}`;
    if (!held.has(name)) names.push(name);
  }
  return names;
}

/** "Create groups": N empty groups in a group set, new or existing. */
export function CreateGroupsDialog({
  classId,
  groupSet,
  takenNames,
}: Readonly<{ classId: string; groupSet: string; takenNames: (set: string) => string[] }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const create = useClassMutation(
    classMutationOptions(queryClient, useServerFn(createGroupsFn)),
    (_data, variables) => m.classes_groups_created({ count: formatNumber(variables.names.length) }),
    { inForm: true },
  );
  const defaults: CreateGroupsForm = {
    groupSet: groupSet || m.classes_group_set_default(),
    count: 2,
    prefix: m.classes_group_prefix_default(),
  };
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: createGroupsFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const set = value.groupSet.trim();
      const names = nextGroupNames(value.prefix, value.count, takenNames(set));
      try {
        await create.mutateAsync({ classId, groupSet: set, names });
        setOpen(false);
        formApi.reset();
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  return (
    <GroupDialog
      open={open}
      onOpenChange={setOpen}
      label={m.classes_groups_create()}
      icon={<PlusIcon aria-hidden="true" data-icon="inline-start" />}
      title={m.classes_groups_create_title()}
      description={m.classes_groups_create_description()}
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
            <form.AppField name="groupSet">
              {(field) => (
                <field.TextField
                  label={m.classes_field_group_set()}
                  description={m.classes_field_group_set_help()}
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
            <form.AppField name="count">
              {(field) => (
                <field.NumberField label={m.classes_field_group_count()} min={1} max={GROUPS_MAX} />
              )}
            </form.AppField>
            <form.AppField name="prefix">
              {(field) => (
                <field.TextField
                  label={m.classes_field_group_prefix()}
                  description={m.classes_field_group_prefix_help()}
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
          </FieldGroup>
          <Footer>
            <form.SubmitButton>{m.classes_groups_create_submit()}</form.SubmitButton>
          </Footer>
        </form.AppForm>
      </form>
    </GroupDialog>
  );
}

/** "Split the class": every student into a new group set, groups of at most a size. */
export function AutoSplitDialog({ classId }: Readonly<{ classId: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const split = useClassMutation(
    classMutationOptions(queryClient, useServerFn(autoSplitFn)),
    (data) => m.classes_groups_split_done({ count: formatNumber(data.groupIds.length) }),
    { inForm: true },
  );
  const defaults: AutoSplitForm = {
    groupSet: "",
    size: 2,
    order: "alphabetical",
    prefix: m.classes_group_prefix_default(),
  };
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: autoSplitFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await split.mutateAsync({ classId, ...value });
        setOpen(false);
        formApi.reset();
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  return (
    <GroupDialog
      open={open}
      onOpenChange={setOpen}
      label={m.classes_groups_split()}
      icon={<ShuffleIcon aria-hidden="true" data-icon="inline-start" />}
      title={m.classes_groups_split_title()}
      description={m.classes_groups_split_description()}
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
            <form.AppField name="groupSet">
              {(field) => (
                <field.TextField
                  label={m.classes_field_group_set()}
                  description={m.classes_field_group_set_new_help()}
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
            <form.AppField name="size">
              {(field) => (
                <field.NumberField
                  label={m.classes_field_group_size()}
                  description={m.classes_field_group_size_help()}
                  min={1}
                  max={GROUP_SIZE_MAX}
                />
              )}
            </form.AppField>
            <form.AppField name="order">
              {(field) => (
                <field.RadioGroupField
                  label={m.classes_field_split_order()}
                  options={[
                    { value: "alphabetical", label: m.classes_split_alphabetical() },
                    { value: "random", label: m.classes_split_random() },
                  ]}
                />
              )}
            </form.AppField>
            <form.AppField name="prefix">
              {(field) => (
                <field.TextField
                  label={m.classes_field_group_prefix()}
                  description={m.classes_field_group_prefix_help()}
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
          </FieldGroup>
          <Footer>
            <form.SubmitButton>{m.classes_groups_split_submit()}</form.SubmitButton>
          </Footer>
        </form.AppForm>
      </form>
    </GroupDialog>
  );
}

/** "Copy a group set" from another class the teacher teaches: groups without members. */
export function CopyGroupSetDialog({ classId }: Readonly<{ classId: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const sources = useQuery({ ...groupSetSourcesQueryOptions(classId), enabled: open });
  const copy = useClassMutation(
    classMutationOptions(queryClient, useServerFn(copyGroupSetFn)),
    (data) => m.classes_groups_copied({ count: formatNumber(data.count) }),
    { inForm: true },
  );
  const options = (sources.data ?? []).flatMap((source) =>
    source.groupSets.map((set) => ({
      value: JSON.stringify([source.id, set]),
      label: m.classes_copy_set_option({ set, class: classLabel(source) }),
    })),
  );
  const defaults: CopyGroupSetForm = { source: "" };
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: copyGroupSetFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const picked = options.find((option) => option.value === value.source);
      const parsed: unknown = picked ? JSON.parse(picked.value) : null;
      if (
        !Array.isArray(parsed) ||
        typeof parsed[0] !== "string" ||
        typeof parsed[1] !== "string"
      ) {
        return;
      }
      try {
        await copy.mutateAsync({ classId, sourceClassId: parsed[0], groupSet: parsed[1] });
        setOpen(false);
        formApi.reset();
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  return (
    <GroupDialog
      open={open}
      onOpenChange={setOpen}
      label={m.classes_groups_copy()}
      icon={<CopyIcon aria-hidden="true" data-icon="inline-start" />}
      title={m.classes_groups_copy_title()}
      description={m.classes_groups_copy_description()}
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
          {sources.isSuccess && options.length === 0 ? (
            <p className="text-muted-foreground">{m.classes_copy_set_none()}</p>
          ) : (
            <FieldGroup>
              <form.AppField name="source">
                {(field) => (
                  <field.SelectField
                    label={m.classes_copy_set_source()}
                    placeholder={m.classes_copy_set_placeholder()}
                    options={options}
                  />
                )}
              </form.AppField>
            </FieldGroup>
          )}
          <Footer>
            <form.SubmitButton>{m.classes_groups_copy_submit()}</form.SubmitButton>
          </Footer>
        </form.AppForm>
      </form>
    </GroupDialog>
  );
}

/** "Rename" of one group. */
export function RenameGroupDialog({
  classId,
  groupId,
  name,
}: Readonly<{ classId: string; groupId: string; name: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const rename = useClassMutation(
    classMutationOptions(queryClient, useServerFn(renameGroupFn)),
    (_data, variables) => m.classes_group_renamed({ name: variables.name.trim() }),
    { inForm: true },
  );
  const defaults: RenameGroupForm = { name };
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: renameGroupFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await rename.mutateAsync({ classId, groupId, ...value });
        setOpen(false);
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  return (
    <GroupDialog
      open={open}
      onOpenChange={setOpen}
      label={m.classes_group_rename({ name })}
      icon={<PencilIcon aria-hidden="true" data-icon="inline-start" />}
      title={m.classes_group_rename_title({ name })}
      description={m.classes_group_rename_description()}
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
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label={m.classes_field_group_name()}
                  maxLength={GROUP_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
          </FieldGroup>
          <Footer>
            <form.SubmitButton>{m.classes_save()}</form.SubmitButton>
          </Footer>
        </form.AppForm>
      </form>
    </GroupDialog>
  );
}
