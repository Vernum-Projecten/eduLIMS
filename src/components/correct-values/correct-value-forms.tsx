// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardPasteIcon, PlusIcon, SaveIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useAppForm } from "@/components/form/app-form";
import { focusById } from "@/components/simulations/focus";
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
import { parsePastedRows, SAMPLE_NUMBER_MAX } from "@/lib/correct-values";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatDecimal, formatNumber } from "@/lib/i18n/format";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { setCorrectValuesFn } from "@/server/correct-values/functions";
import type { CorrectValueEntry, CorrectValuesPage } from "@/server/correct-values/queries";
import { correctValuesInvalidation } from "@/server/correct-values/query-options";
import {
  type CorrectValueRowForm,
  correctValueRowSchema,
  type PasteForm,
  pasteFormSchema,
} from "@/server/correct-values/schemas";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";

type Options = CorrectValuesPage["options"];

/** The id of the add dialog's first field, which takes focus after each save. */
const SAMPLE_FIELD = "correct-value-sample";

/** The success message of an entry: how many values were added and changed. */
function savedMessage(outcome: { added: number; changed: number; unchanged: number }): string {
  return m.correct_values_saved({
    added: formatNumber(outcome.added),
    changed: formatNumber(outcome.changed),
    unchanged: formatNumber(outcome.unchanged),
  });
}

/** The action that sets correct values, announcing what changed (WCAG 4.1.3). */
function useSetValues(simulationId: string) {
  const queryClient = useQueryClient();
  const call = useServerFn(setCorrectValuesFn);
  return useSimulationAction(
    simulationMutationOptions(queryClient, call, correctValuesInvalidation.values(simulationId)),
    { success: (outcome) => savedMessage(outcome), toastErrors: false },
  );
}

/** The refusal of the one-value form: about the test at the test field, else at the top. */
function rowRefusal(error: unknown) {
  const code = simulationErrorCode(error);
  const message = simulationErrorMessage(code);
  const aboutTest = code === "test_not_found" || code === "test_retired";
  return aboutTest ? { fields: { testId: message } } : { form: message };
}

/** The refusal of a form without a test field: at the top (WCAG 3.3.1). */
function formRefusalOf(error: unknown) {
  return { form: simulationErrorMessage(simulationErrorCode(error)) };
}

/** The refusal of the paste form: about a test at the pasted rows, else at the top. */
function pasteRefusal(error: unknown) {
  const code = simulationErrorCode(error);
  const message = simulationErrorMessage(code);
  const aboutTest = code === "test_not_found" || code === "test_retired";
  return aboutTest ? { fields: { text: message } } : { form: message };
}

function testOptions(options: Options) {
  return options.map((test) => ({
    value: test.id,
    label: test.unit
      ? m.correct_values_test_option({ test: test.name, unit: test.unit })
      : test.name,
  }));
}

/**
 * One correct value at a time, in a dialog (D10): the sample number, the test and the value. The
 * dialog stays open after a save, empty for the next value, so a teacher enters a series.
 */
export function AddCorrectValueDialog({
  control,
  simulationId,
  options,
}: Readonly<{ control: DialogControl; simulationId: string; options: Options }>) {
  const save = useSetValues(simulationId);
  const choices = useMemo(() => testOptions(options), [options]);
  const [saved, setSaved] = useState("");
  const form = useAppForm({
    defaultValues: { sampleNumber: "", testId: "", value: "" } satisfies CorrectValueRowForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: correctValueRowSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({ simulationId, rows: [value] });
      } catch (error) {
        applyServerRefusal(formApi, rowRefusal(error));
        return;
      }
      // The dialog stays open over the toasts' layer, so it says what it saved itself (WCAG
      // 4.1.3); the next value starts at the first field (WCAG 2.4.3).
      const test = options.find((option) => option.id === value.testId)?.name ?? "";
      setSaved(m.correct_values_saved_item({ sample: value.sampleNumber, test }));
      formApi.reset();
      focusById(SAMPLE_FIELD);
    },
  });
  return (
    <FormDialog
      control={control}
      title={m.correct_values_add_heading()}
      description={m.correct_values_add_description()}
      onClose={() => {
        form.reset();
        setSaved("");
      }}
    >
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {saved}
      </p>
      <form
        noValidate
        aria-label={m.correct_values_add_form()}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.FormErrors />
          <FieldGroup>
            <form.AppField name="sampleNumber">
              {(field) => (
                <field.TextField
                  id={SAMPLE_FIELD}
                  label={m.correct_values_sample()}
                  maxLength={SAMPLE_NUMBER_MAX}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </form.AppField>
            <form.AppField name="testId">
              {(field) => (
                <field.SelectField
                  label={m.correct_values_test()}
                  placeholder={m.correct_values_test_placeholder()}
                  options={choices}
                />
              )}
            </form.AppField>
            <form.AppField name="value">
              {(field) => (
                <field.TextField
                  label={m.correct_values_value()}
                  description={m.correct_values_value_help()}
                  inputMode="decimal"
                  autoComplete="off"
                />
              )}
            </form.AppField>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {m.correct_values_close()}
              </Button>
            </DialogClose>
            <form.SubmitButton icon={<PlusIcon aria-hidden="true" data-icon="inline-start" />}>
              {m.correct_values_add()}
            </form.SubmitButton>
          </DialogFooter>
        </form.AppForm>
      </form>
    </FormDialog>
  );
}

/**
 * Many correct values at once, in a dialog (D10): lines copied from a spreadsheet, each a sample
 * number, a test name and a value. A line that does not read is named at the field; nothing is
 * stored until every line reads, and a saved paste closes the dialog.
 */
export function PasteCorrectValuesDialog({
  control,
  simulationId,
  options,
}: Readonly<{ control: DialogControl; simulationId: string; options: Options }>) {
  const save = useSetValues(simulationId);
  const schema = useMemo(() => pasteFormSchema(options), [options]);
  const form = useAppForm({
    defaultValues: { text: "" } satisfies PasteForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value, formApi }) => {
      const { rows } = parsePastedRows(value.text, options);
      try {
        await save.mutateAsync({ simulationId, rows });
      } catch (error) {
        applyServerRefusal(formApi, pasteRefusal(error));
        return;
      }
      formApi.reset();
      control.onOpenChange(false);
    },
  });
  return (
    <FormDialog
      control={control}
      title={m.correct_values_paste_heading()}
      description={m.correct_values_paste_description()}
      onClose={() => form.reset()}
    >
      <form
        noValidate
        aria-label={m.correct_values_paste_form()}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.FormErrors />
          <FieldGroup>
            <form.AppField name="text">
              {(field) => (
                <field.TextareaField
                  label={m.correct_values_paste()}
                  description={m.correct_values_paste_help()}
                  rows={6}
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
            <form.SubmitButton
              icon={<ClipboardPasteIcon aria-hidden="true" data-icon="inline-start" />}
            >
              {m.correct_values_paste_submit()}
            </form.SubmitButton>
          </DialogFooter>
        </form.AppForm>
      </form>
    </FormDialog>
  );
}

/** A dialog around a form: its title and description, focus back to the opener on close. */
function FormDialog({
  control,
  title,
  description,
  onClose,
  children,
}: Readonly<{
  control: DialogControl;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) onClose();
        control.onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const changeSchema = correctValueRowSchema.pick({ value: true });

/** Changes one correct value, in a dialog (D10: changeable before, during and after). */
export function ChangeValueDialog({
  control,
  row,
  item,
}: Readonly<{
  control: DialogControl;
  row: CorrectValueEntry & { simulationId: string };
  item: string;
}>) {
  const save = useSetValues(row.simulationId);
  const initial = { value: formatDecimal(row.value) };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: changeSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({
          simulationId: row.simulationId,
          rows: [{ sampleNumber: row.sampleNumber, testId: row.testId, value: value.value }],
        });
      } catch (error) {
        applyServerRefusal(formApi, formRefusalOf(error));
        return;
      }
      control.onOpenChange(false);
    },
  });
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
              <DialogTitle>{m.correct_values_change_title({ item })}</DialogTitle>
              <DialogDescription>{m.correct_values_change_description()}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="value">
                {(field) => (
                  <field.TextField
                    label={m.correct_values_value()}
                    description={m.correct_values_value_help()}
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
                {m.correct_values_change_submit()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
