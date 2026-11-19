// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  InfoIcon,
  ListChecksIcon,
  type LucideIcon,
  MailPlusIcon,
} from "lucide-react";
import { useId, useMemo } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { useAppForm } from "@/components/form/app-form";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ListTable } from "@/components/simulations/list-table";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatNumber } from "@/lib/i18n/format";
import { emailLineLabel, simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { cn } from "@/lib/utils";
import type { EmailLine, EmailLineStatus } from "@/server/simulations/emails";
import { addEmailsFn, previewEmailsFn } from "@/server/simulations/functions";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";
import { type EmailListForm, emailListFormSchema } from "@/server/simulations/schemas";

/** The icon of each outcome; the text beside it carries the meaning (WCAG 1.4.1). */
const LINE_ICONS: Record<EmailLineStatus, LucideIcon> = {
  new: CircleCheckIcon,
  invalid: CircleXIcon,
  repeated: CopyIcon,
  in_this_lab: InfoIcon,
  in_other_lab: CircleAlertIcon,
};

/** A line of the outcome with its place in the list, which keeps repeated lines apart. */
interface OutcomeRow extends EmailLine {
  position: number;
}

const helper = createDataTableColumnHelper<OutcomeRow>();

const columns = helper.columns([
  helper.accessor("email", {
    id: "email",
    header: () => m.labs_paste_col_address(),
    cell: ({ row }) => <span className="break-all">{row.original.email}</span>,
  }),
  helper.accessor("status", {
    id: "status",
    header: () => m.labs_paste_col_outcome(),
    cell: ({ row }) => {
      const Icon = LINE_ICONS[row.original.status];
      return (
        <span
          className={cn(
            "flex items-start gap-2",
            row.original.status !== "new" && "text-muted-foreground",
          )}
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {emailLineLabel(row.original)}
        </span>
      );
    },
  }),
]);

/**
 * The panel that adds the members of a lab by pasting their addresses (D10). "Check the list"
 * shows the outcome of every line before anything is stored; only then does "Add" store the new
 * addresses as waiting. A change to the list drops the outcome, so what is added is what was
 * checked.
 */
export function PastePanel({
  simulationId,
  labId,
  labName,
}: Readonly<{ simulationId: string; labId: string; labName: string }>) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const callPreview = useServerFn(previewEmailsFn);
  const callAdd = useServerFn(addEmailsFn);
  const preview = useSimulationAction(
    simulationMutationOptions(queryClient, callPreview, simulationActionKeys.previewEmails()),
    { success: null, toastErrors: false },
  );
  const add = useSimulationAction(
    simulationMutationOptions(queryClient, callAdd, simulationActionKeys.addEmails(simulationId)),
    {
      success: (outcome) =>
        m.labs_paste_added({ count: formatNumber(outcome.added), lab: labName }),
    },
  );
  const empty: EmailListForm = { emails: [] };
  const form = useAppForm({
    defaultValues: empty,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: emailListFormSchema },
    listeners: { onChange: () => preview.reset() },
    onSubmit: async ({ value, formApi }) => {
      try {
        await preview.mutateAsync({ ...emailListFormSchema.parse(value), labId });
      } catch (error) {
        applyServerRefusal(formApi, {
          form: simulationErrorMessage(simulationErrorCode(error)),
        });
      }
    },
  });

  const lines = preview.data;
  const checked = preview.variables?.emails;
  const rows = useMemo(() => lines?.map((line, position) => ({ ...line, position })), [lines]);
  const added = lines?.filter((line) => line.status === "new").length ?? 0;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-lg font-semibold">
          {m.labs_paste_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_paste_description()}</p>
      </div>
      <form
        noValidate
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-lg border p-4"
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
                  label={m.labs_paste_label()}
                  description={m.labs_paste_help()}
                />
              )}
            </form.AppField>
          </FieldGroup>
          <div>
            <form.SubmitButton
              icon={<ListChecksIcon aria-hidden="true" data-icon="inline-start" />}
            >
              {m.labs_paste_check()}
            </form.SubmitButton>
          </div>
        </form.AppForm>
      </form>
      <p role="status" className="sr-only">
        {lines
          ? m.labs_paste_summary({
              added: formatNumber(added),
              skipped: formatNumber(lines.length - added),
            })
          : ""}
      </p>
      {rows && checked && (
        <div className="flex flex-col gap-4">
          <p aria-hidden="true">
            {m.labs_paste_summary({
              added: formatNumber(added),
              skipped: formatNumber(rows.length - added),
            })}
          </p>
          <ListTable
            columns={columns}
            data={rows}
            rowId={(row) => String(row.position)}
            caption={m.labs_paste_caption()}
            busy={false}
            empty={null}
          />
          {added > 0 ? (
            <div>
              <Button
                type="button"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate(
                    { labId, emails: checked },
                    {
                      onSuccess: () => {
                        form.reset(empty);
                        preview.reset();
                      },
                    },
                  )
                }
              >
                <MailPlusIcon aria-hidden="true" data-icon="inline-start" />
                {m.labs_paste_add({ count: formatNumber(added) })}
              </Button>
            </div>
          ) : (
            <p>{m.labs_paste_nothing()}</p>
          )}
        </div>
      )}
    </section>
  );
}
