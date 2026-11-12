// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileCheckIcon, SendIcon } from "lucide-react";
import { type ChangeEvent, useId, useState } from "react";
import { toast } from "sonner";
import {
  CSV_MAX_BYTES,
  InvitePreview,
  type PreviewRow,
} from "@/components/classes/class-invitations";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { useAppForm } from "@/components/form/app-form";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { parseEmailList } from "@/lib/forms/email-list";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { formatNumber } from "@/lib/i18n/format";
import { adminImportStudentsFn, adminPreviewImportFn } from "@/server/classes/admin-functions";
import { type ImportForm, importFormSchema } from "@/server/classes/admin-schemas";
import {
  classErrorCode,
  classMutationOptions,
  classReadMutationOptions,
} from "@/server/classes/query-options";
import { INVITE_LIST_MAX } from "@/server/classes/schemas";

/**
 * "Import students" (#37, B2): a whole class from a CSV file (one address per line) or pasted
 * addresses. "Check list" previews every row (invalid, duplicate, already a member, already
 * invited, new) before anything is created; "Import" creates pending student invitations, so
 * nobody joins before they sign in with that address themselves.
 */
export function AdminClassImport({ classId }: Readonly<{ classId: string }>) {
  const queryClient = useQueryClient();
  const preview = useMutation(classReadMutationOptions(useServerFn(adminPreviewImportFn)));
  const importer = useClassMutation(
    classMutationOptions(queryClient, useServerFn(adminImportStudentsFn)),
    (outcome) => m.classes_invited({ count: formatNumber(outcome.created) }),
    { inForm: true },
  );
  const [previewed, setPreviewed] = useState<{ key: string; rows: PreviewRow[] } | null>(null);
  const defaults: ImportForm = { emails: [] };
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: importFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const input = { classId, emails: value.emails };
      const key = value.emails.join(",");
      try {
        if (previewed?.key !== key) {
          setPreviewed({ key, rows: await preview.mutateAsync(input) });
          return;
        }
        await importer.mutateAsync(input);
        setPreviewed(null);
        formApi.reset();
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  // A changed list needs a new preview before anything is created.
  const listKey = useStore(form.store, (state) => state.values.emails.join(","));
  const rows = previewed?.key === listKey ? previewed.rows : null;
  const fileId = useId();
  const fileHelpId = useId();

  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      toast.error(m.classes_invite_csv_too_large());
      return;
    }
    const current = form.getFieldValue("emails");
    const added = parseEmailList(await file.text(), current);
    form.setFieldValue("emails", [...current, ...added]);
    toast.success(m.classes_invite_csv_read({ count: formatNumber(added.length) }));
  }

  const fresh = rows?.filter((row) => row.status === "new").length ?? 0;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      aria-label={m.classes_admin_import_form()}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          <form.AppField name="emails">
            {(field) => (
              <field.EmailListField
                label={m.classes_admin_import_emails()}
                description={m.classes_invite_emails_help({ max: formatNumber(INVITE_LIST_MAX) })}
              />
            )}
          </form.AppField>
          <Field>
            <FieldLabel htmlFor={fileId}>{m.classes_admin_import_csv()}</FieldLabel>
            <Input
              id={fileId}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              aria-describedby={fileHelpId}
              onChange={(event) => void readCsv(event)}
            />
            <FieldDescription id={fileHelpId}>{m.classes_invite_csv_help()}</FieldDescription>
          </Field>
        </FieldGroup>
        {rows && <InvitePreview rows={rows} />}
        <div className="flex flex-wrap gap-2">
          {rows ? (
            <form.SubmitButton icon={<SendIcon aria-hidden="true" data-icon="inline-start" />}>
              {fresh > 0
                ? m.classes_admin_import_submit({ count: formatNumber(fresh) })
                : m.classes_invite_nothing()}
            </form.SubmitButton>
          ) : (
            <form.SubmitButton icon={<FileCheckIcon aria-hidden="true" data-icon="inline-start" />}>
              {m.classes_invite_check()}
            </form.SubmitButton>
          )}
        </div>
      </form.AppForm>
    </form>
  );
}
