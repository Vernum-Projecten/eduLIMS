// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTable } from "@tanstack/react-table";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardCopyIcon,
  MailIcon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { type ChangeEvent, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { classLabel } from "@/components/classes/class-name";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import { useAppForm } from "@/components/form/app-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { classCan, memberPermission } from "@/lib/classes";
import { parseEmailList } from "@/lib/forms/email-list";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage, classRoleLabel, inviteRowStatusLabel } from "@/lib/i18n/class-labels";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import {
  cancelInvitationFn,
  createInvitationsFn,
  previewInvitationsFn,
  resendInvitationFn,
} from "@/server/classes/functions";
import type { InvitationView } from "@/server/classes/queries";
import {
  type ClassPage,
  classErrorCode,
  classMutationOptions,
  classReadMutationOptions,
} from "@/server/classes/query-options";
import { INVITE_LIST_MAX, type InviteForm, inviteFormSchema } from "@/server/classes/schemas";

// NOTE: no requirement governs this: our own design. A list of 500 addresses is far smaller.
const CSV_MAX_BYTES = 256 * 1024;

/** Returns the translated invitation text: the class, the sign-in link and the steps (#28). */
export function invitationText(page: Pick<ClassPage, "name" | "academicYear">, origin: string) {
  return m.classes_invitation_text({
    class: classLabel({ name: page.name, academicYear: page.academicYear }),
    link: `${origin}/login`,
  });
}

/** "Copy invitation text": puts the translated text on the clipboard (no email is sent). */
function CopyInvitationText({ page }: Readonly<{ page: ClassPage }>) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        const text = invitationText(page, window.location.origin);
        navigator.clipboard.writeText(text).then(
          () => toast.success(m.classes_invitation_text_copied()),
          () => toast.error(m.classes_invitation_text_failed()),
        );
      }}
    >
      <ClipboardCopyIcon aria-hidden="true" data-icon="inline-start" />
      {m.classes_invitation_text_copy()}
    </Button>
  );
}

type PreviewRow = { email: string; status: Parameters<typeof inviteRowStatusLabel>[0] };

function listKeyOf(value: InviteForm): string {
  return `${value.role}|${value.emails.join(",")}`;
}

/** The preview of a list: every address with what will happen to it, before anything is sent. */
function InvitePreview({ rows }: Readonly<{ rows: readonly PreviewRow[] }>) {
  const fresh = rows.filter((row) => row.status === "new").length;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-lg border p-4">
      <h4 id={headingId} className="font-medium">
        {m.classes_invite_preview_title()}
      </h4>
      <p role="status">
        {m.classes_invite_preview_summary({
          fresh: formatNumber(fresh),
          skipped: formatNumber(rows.length - fresh),
        })}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a duplicate address repeats, so its position is its identity.
          <li key={`${row.email}-${index}`} className="flex flex-wrap items-center gap-2">
            <span className="break-all">{row.email}</span>
            {row.status === "new" ? (
              <Badge variant="secondary">
                <CircleCheckIcon aria-hidden="true" data-icon="inline-start" />
                {inviteRowStatusLabel(row.status)}
              </Badge>
            ) : (
              <Badge variant="outline">
                <CircleAlertIcon aria-hidden="true" data-icon="inline-start" />
                {inviteRowStatusLabel(row.status)}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The invitation form (#28): a class role, then addresses typed, pasted or read from a CSV
 * file (one address per line). "Check list" shows the preview; "Invite" creates the new rows.
 */
function InvitePeopleForm({ page }: Readonly<{ page: ClassPage }>) {
  const queryClient = useQueryClient();
  const preview = useMutation(classReadMutationOptions(useServerFn(previewInvitationsFn)));
  const create = useClassMutation(
    classMutationOptions(queryClient, useServerFn(createInvitationsFn)),
    (outcome) => m.classes_invited({ count: formatNumber(outcome.created) }),
    { inForm: true },
  );
  const canInviteTeachers = classCan(page.myRole, memberPermission("teacher", "invite"));
  const roleOptions = (["student", "teacher"] as const)
    .filter((role) => role === "student" || canInviteTeachers)
    .map((role) => ({ value: role, label: classRoleLabel(role) }));
  const defaults: InviteForm = { role: "student", emails: [] };
  const [previewed, setPreviewed] = useState<{ key: string; rows: PreviewRow[] } | null>(null);
  const form = useAppForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: inviteFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const input = { classId: page.id, role: value.role, emails: value.emails };
      const key = listKeyOf(value);
      try {
        if (previewed?.key !== key) {
          setPreviewed({ key, rows: await preview.mutateAsync(input) });
          return;
        }
        await create.mutateAsync(input);
        setPreviewed(null);
        formApi.reset();
      } catch (error) {
        applyServerRefusal(formApi, { form: classErrorMessage(classErrorCode(error)) });
      }
    },
  });
  // A changed list or role needs a new preview before anything is created.
  const listKey = useStore(form.store, (state) => listKeyOf(state.values));
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
      aria-label={m.classes_invite_form()}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          {roleOptions.length > 1 && (
            <form.AppField name="role">
              {(field) => (
                <field.RadioGroupField label={m.classes_invite_role()} options={roleOptions} />
              )}
            </form.AppField>
          )}
          <form.AppField name="emails">
            {(field) => (
              <field.EmailListField
                label={m.classes_invite_emails()}
                description={m.classes_invite_emails_help({ max: formatNumber(INVITE_LIST_MAX) })}
              />
            )}
          </form.AppField>
          <Field>
            <FieldLabel htmlFor={fileId}>{m.classes_invite_csv()}</FieldLabel>
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
                ? m.classes_invite_submit({ count: formatNumber(fresh) })
                : m.classes_invite_nothing()}
            </form.SubmitButton>
          ) : (
            <form.SubmitButton icon={<MailIcon aria-hidden="true" data-icon="inline-start" />}>
              {m.classes_invite_check()}
            </form.SubmitButton>
          )}
          <CopyInvitationText page={page} />
        </div>
      </form.AppForm>
    </form>
  );
}

/** Resend and cancel of one pending invitation, as the viewer's class role allows. */
function InvitationActions({
  page,
  invitation,
}: Readonly<{ page: ClassPage; invitation: InvitationView }>) {
  const queryClient = useQueryClient();
  const resend = useClassMutation(
    classMutationOptions(queryClient, useServerFn(resendInvitationFn)),
    () => m.classes_invitation_resent({ email: invitation.email }),
  );
  const cancel = useClassMutation(
    classMutationOptions(queryClient, useServerFn(cancelInvitationFn)),
    () => m.classes_invitation_canceled({ email: invitation.email }),
  );
  if (page.archivedAt !== null) return null;
  if (!classCan(page.myRole, memberPermission(invitation.role, "invite"))) return null;
  const input = { classId: page.id, invitationId: invitation.id };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={resend.isPending}
        onClick={() => resend.mutate(input)}
      >
        <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
        {m.classes_invitation_resend({ email: invitation.email })}
      </Button>
      <ConfirmButton
        icon={XIcon}
        label={m.classes_invitation_cancel({ email: invitation.email })}
        title={m.classes_invitation_cancel_title()}
        description={m.classes_invitation_cancel_description({ email: invitation.email })}
        confirm={m.classes_invitation_cancel_confirm()}
        destructive
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate(input)}
      />
    </div>
  );
}

const helper = createDataTableColumnHelper<InvitationView>();

/** The pending invitations of a class, expired ones marked, with resend and cancel. */
function PendingInvitations({ page }: Readonly<{ page: ClassPage }>) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("email", {
          id: "email",
          meta: { label: () => m.classes_col_email() },
          header: () => m.classes_col_email(),
          cell: ({ getValue }) => <span className="break-all">{getValue()}</span>,
        }),
        helper.accessor("role", {
          id: "role",
          meta: { label: () => m.classes_col_role() },
          header: () => m.classes_col_role(),
          cell: ({ getValue }) => classRoleLabel(getValue()),
        }),
        helper.accessor("expiresAt", {
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
        helper.display({
          id: "actions",
          meta: { label: () => m.classes_col_actions(), className: "text-right" },
          header: () => <span className="sr-only">{m.classes_col_actions()}</span>,
          cell: ({ row }) => <InvitationActions page={page} invitation={row.original} />,
        }),
      ]),
    [page],
  );
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: page.invitations,
    rowCount: page.invitations.length,
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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MailIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h4>{m.classes_invitations_empty()}</h4>
            </EmptyTitle>
            <EmptyDescription>{m.classes_invitations_empty_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
    />
  );
}

/** The invitations tab: the form (not on an archived class) and the pending invitations. */
export function ClassInvitations({ page }: Readonly<{ page: ClassPage }>) {
  const canInvite = page.archivedAt === null && classCan(page.myRole, { student: ["invite"] });
  return (
    <div className="flex flex-col gap-8">
      {canInvite ? (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
          <h3 id="invite-heading" className="text-lg font-semibold">
            {m.classes_invite_title()}
          </h3>
          <p className="text-muted-foreground">{m.classes_invite_description()}</p>
          <InvitePeopleForm page={page} />
        </section>
      ) : (
        <p className="text-muted-foreground">{m.classes_archived_read_only()}</p>
      )}
      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h3 id="pending-heading" className="text-lg font-semibold">
          {m.classes_invitations_title()}
        </h3>
        <PendingInvitations page={page} />
      </section>
    </div>
  );
}
