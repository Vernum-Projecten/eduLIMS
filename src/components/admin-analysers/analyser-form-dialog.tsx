// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useAnalyserMutation } from "@/components/admin-analysers/use-analyser-mutation";
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
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import {
  ANALYSER_LOCATION_MAX,
  ANALYSER_MODEL_MAX,
  ANALYSER_NOTES_MAX,
  ANALYSER_ROUTES,
  ANALYSER_SERIAL_MAX,
  EDITABLE_ANALYSER_STATUSES,
  type EditableAnalyserStatus,
} from "@/lib/analysers";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import {
  analyserErrorMessage,
  analyserRouteLabel,
  analyserStatusLabel,
} from "@/lib/i18n/analyser-labels";
import { createAdminAnalyser, updateAdminAnalyser } from "@/server/analysers/functions";
import type { AnalyserRow } from "@/server/analysers/queries";
import {
  analyserErrorCode,
  createAnalyserMutationOptions,
  updateAnalyserMutationOptions,
} from "@/server/analysers/query-options";
import { type AnalyserForm, analyserFormSchema } from "@/server/analysers/schemas";

const EMPTY: AnalyserForm = {
  model: "",
  serialNumber: "",
  location: "",
  route: "",
  status: "in_use",
  notes: "",
};

function editableStatus(row: AnalyserRow): EditableAnalyserStatus {
  return row.status === "maintenance" ? "maintenance" : "in_use";
}

function valuesOf(row: AnalyserRow | undefined): AnalyserForm {
  if (!row) return EMPTY;
  return {
    model: row.model,
    serialNumber: row.serialNumber,
    location: row.location,
    route: row.route,
    status: editableStatus(row),
    notes: row.notes ?? "",
  };
}

/** Where the dialog opens from: the parent controls it and gets focus back on close. */
export interface AnalyserDialogControl {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The create and edit form of an analyser (B3, #35) in a dialog, on `useAppForm` with the
 * schema the server function validates with. A taken serial number shows at its field; any
 * other refusal at the top of the form, with focus moved to it (WCAG 3.3.1).
 */
export function AnalyserFormDialog({
  analyser,
  control,
}: Readonly<{ analyser?: AnalyserRow; control: AnalyserDialogControl }>) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createAdminAnalyser);
  const callUpdate = useServerFn(updateAdminAnalyser);
  const create = useAnalyserMutation(
    createAnalyserMutationOptions(queryClient, callCreate),
    (_id, data) => m.admin_analysers_created({ model: data.model }),
    false,
  );
  const update = useAnalyserMutation(
    updateAnalyserMutationOptions(queryClient, callUpdate),
    (_id, data) => m.admin_analysers_updated({ model: data.model }),
    false,
  );
  const form = useAppForm({
    defaultValues: valuesOf(analyser),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: analyserFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const data = analyserFormSchema.parse(value);
      try {
        if (analyser) await update.mutateAsync({ ...data, analyserId: analyser.id });
        else await create.mutateAsync(data);
      } catch (error) {
        const code = analyserErrorCode(error);
        applyServerRefusal(
          formApi,
          code === "serial_taken"
            ? { fields: { serialNumber: analyserErrorMessage(code) } }
            : { form: analyserErrorMessage(code) },
        );
        return;
      }
      control.onOpenChange(false);
      formApi.reset();
    },
  });

  const title = analyser
    ? m.admin_analysers_edit_title({ model: analyser.model, serial: analyser.serialNumber })
    : m.admin_analysers_create_title();

  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) form.reset(valuesOf(analyser));
        control.onOpenChange(open);
      }}
    >
      {/* The form is taller than a short or zoomed viewport, so the dialog scrolls (WCAG 1.4.10). */}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={control.onCloseAutoFocus}
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
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{m.admin_analysers_form_description()}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="model">
                {(field) => (
                  <field.TextField
                    label={m.admin_analysers_model()}
                    description={m.admin_analysers_model_help()}
                    maxLength={ANALYSER_MODEL_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="serialNumber">
                {(field) => (
                  <field.TextField
                    label={m.admin_analysers_serial()}
                    maxLength={ANALYSER_SERIAL_MAX}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </form.AppField>
              <form.AppField name="location">
                {(field) => (
                  <field.TextField
                    label={m.admin_analysers_location()}
                    description={m.admin_analysers_location_help()}
                    maxLength={ANALYSER_LOCATION_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="route">
                {(field) => (
                  <field.SelectField
                    label={m.admin_analysers_route()}
                    description={m.admin_analysers_route_help()}
                    placeholder={m.admin_analysers_route_placeholder()}
                    options={ANALYSER_ROUTES.map((route) => ({
                      value: route,
                      label: analyserRouteLabel(route),
                    }))}
                  />
                )}
              </form.AppField>
              <form.AppField name="status">
                {(field) => (
                  <field.RadioGroupField
                    label={m.admin_analysers_status()}
                    options={EDITABLE_ANALYSER_STATUSES.map((status) => ({
                      value: status,
                      label: analyserStatusLabel(status),
                    }))}
                  />
                )}
              </form.AppField>
              <form.AppField name="notes">
                {(field) => (
                  <field.TextareaField
                    label={m.admin_analysers_notes()}
                    description={m.admin_analysers_notes_help({
                      max: String(ANALYSER_NOTES_MAX),
                    })}
                    maxLength={ANALYSER_NOTES_MAX}
                    rows={3}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.admin_users_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
                {analyser ? m.admin_analysers_save() : m.admin_analysers_create()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
