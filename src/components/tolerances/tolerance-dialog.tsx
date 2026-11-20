// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import type { DialogControl } from "@/components/simulations/name-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
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
import { formatDecimal } from "@/lib/i18n/format";
import { toleranceErrorMessage } from "@/lib/i18n/tolerance-labels";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";
import { setToleranceFn } from "@/server/tolerances/functions";
import type { ToleranceEntry } from "@/server/tolerances/queries";
import { tolerancesInvalidation } from "@/server/tolerances/query-options";
import { type ToleranceForm, toleranceFormSchema } from "@/server/tolerances/schemas";

/**
 * The tolerance form of one test in the student's own lab (S13): the lower and the upper limit.
 * It starts empty, or with the lab's own current tolerance; never with a suggested value (W7).
 */
export function ToleranceDialog({
  control,
  labId,
  test,
}: Readonly<{ control: DialogControl; labId: string; test: ToleranceEntry }>) {
  const queryClient = useQueryClient();
  const call = useServerFn(setToleranceFn);
  const save = useSimulationAction(
    simulationMutationOptions(queryClient, call, tolerancesInvalidation.set(labId)),
    {
      success: (outcome) =>
        outcome.changed
          ? m.tolerances_saved({ test: test.name })
          : m.tolerances_unchanged({ test: test.name }),
      toastErrors: false,
    },
  );
  const initial: ToleranceForm =
    test.lower !== null && test.upper !== null
      ? { lower: formatDecimal(test.lower), upper: formatDecimal(test.upper) }
      : { lower: "", upper: "" };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: toleranceFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({ ...value, labId, testId: test.testId });
      } catch (error) {
        applyServerRefusal(formApi, { form: toleranceErrorMessage(simulationErrorCode(error)) });
        return;
      }
      control.onOpenChange(false);
    },
  });
  const unitHelp = test.unit ? m.tolerances_unit_help({ unit: test.unit }) : undefined;
  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) form.reset(initial);
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
              <DialogTitle>{m.tolerances_dialog_title({ test: test.name })}</DialogTitle>
              <DialogDescription>{m.tolerances_dialog_description()}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="lower">
                {(field) => (
                  <field.TextField
                    label={m.tolerances_lower_label()}
                    description={unitHelp}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="upper">
                {(field) => (
                  <field.TextField
                    label={m.tolerances_upper_label()}
                    description={unitHelp}
                    inputMode="decimal"
                    autoComplete="off"
                  />
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
                {m.tolerances_submit()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
