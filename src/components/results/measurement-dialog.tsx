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
import { resultsErrorMessage } from "@/lib/i18n/results-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { ResultsActionError } from "@/server/results/access";
import { recordMeasurementFn } from "@/server/results/functions";
import type { RequestedTestRow, ResultsRequestRow } from "@/server/results/queries";
import {
  resultsErrorCode,
  resultsInvalidation,
  resultsMutationOptions,
} from "@/server/results/query-options";
import { type MeasurementForm, measurementFormSchema } from "@/server/results/schemas";

/** The field of the form each refusal is about (WCAG 3.3.1); the rest show at the top. */
const REFUSAL_FIELD: Partial<Record<ResultsActionError, "sampleId" | "value">> = {
  sample_not_found: "sampleId",
  value_invalid: "value",
};

/**
 * The form of a measurement the team enters by hand (S14): the sample it measured and the
 * value, nothing filled in. A second measurement is kept beside the first.
 */
export function MeasurementDialog({
  control,
  labId,
  request,
  test,
}: Readonly<{
  control: DialogControl;
  labId: string;
  request: ResultsRequestRow;
  test: RequestedTestRow;
}>) {
  const queryClient = useQueryClient();
  const call = useServerFn(recordMeasurementFn);
  const save = useSimulationAction(
    resultsMutationOptions(queryClient, call, resultsInvalidation.measure(labId)),
    { success: () => m.results_measurement_saved({ test: test.name }), toastErrors: false },
  );
  const only = request.samples.length === 1 ? request.samples[0]?.id : undefined;
  const initial: MeasurementForm = { sampleId: only ?? "", value: "" };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: measurementFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({
          labId,
          requestId: request.id,
          testId: test.testId,
          sampleId: value.sampleId,
          value: value.value,
        });
      } catch (error) {
        const code = resultsErrorCode(error);
        const message = resultsErrorMessage(code);
        const field = code === null ? undefined : REFUSAL_FIELD[code];
        applyServerRefusal(
          formApi,
          field === undefined ? { form: message } : { fields: { [field]: message } },
        );
        return;
      }
      control.onOpenChange(false);
    },
  });
  const options = request.samples.map((sample) => ({
    value: sample.id,
    label: m.results_sample_option({
      sample: sample.sampleNumber,
      labNumber: formatLabNumber(sample.labNumber),
    }),
  }));
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
              <DialogTitle>{m.results_measure_title({ test: test.name })}</DialogTitle>
              <DialogDescription>{m.results_measure_description()}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="sampleId">
                {(field) => (
                  <field.SelectField
                    label={m.results_sample_label()}
                    placeholder={m.results_sample_placeholder()}
                    options={options}
                  />
                )}
              </form.AppField>
              <form.AppField name="value">
                {(field) => (
                  <field.TextField
                    label={m.results_value_label()}
                    description={
                      test.unit ? m.results_value_unit_help({ unit: test.unit }) : undefined
                    }
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
                {m.results_measure_submit()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
