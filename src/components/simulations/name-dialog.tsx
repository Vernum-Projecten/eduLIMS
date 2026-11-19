// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { SaveIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { z } from "zod";
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
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { simulationErrorCode } from "@/server/simulations/query-options";

/** The values of a name form: a simulation's or a lab's name. */
export interface NameForm {
  name: string;
}

/** Where a dialog opens from: the parent controls it and gets focus back on close. */
export interface DialogControl {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The form that names a simulation or a lab, in a dialog, on `useAppForm` with the schema the
 * server function validates with. `save` throws the server's refusal: a taken lab name shows at
 * the field, any other refusal at the top of the form (WCAG 3.3.1).
 */
export function NameDialog({
  control,
  schema,
  initial,
  title,
  description,
  label,
  submit,
  maxLength,
  save,
}: Readonly<{
  control: DialogControl;
  schema: z.ZodType<NameForm, NameForm>;
  initial: string;
  title: string;
  description: ReactNode;
  label: string;
  submit: string;
  maxLength: number;
  save: (value: NameForm) => Promise<unknown>;
}>) {
  const form = useAppForm({
    defaultValues: { name: initial } satisfies NameForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save(schema.parse(value));
      } catch (error) {
        const code = simulationErrorCode(error);
        applyServerRefusal(
          formApi,
          code === "lab_name_taken"
            ? { fields: { name: simulationErrorMessage(code) } }
            : { form: simulationErrorMessage(code) },
        );
        return;
      }
      control.onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) form.reset({ name: initial });
        control.onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
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
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField label={label} maxLength={maxLength} autoComplete="off" />
                )}
              </form.AppField>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.simulations_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
                {submit}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
