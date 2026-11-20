// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlertIcon, SaveIcon, SlidersHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
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
import { type AccuracyLimits, LIMIT_KINDS } from "@/lib/correct-values";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatDecimal } from "@/lib/i18n/format";
import { limitKindLabel, simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { cn } from "@/lib/utils";
import { setLimitsFn } from "@/server/correct-values/functions";
import type { SimulationTestEntry } from "@/server/correct-values/queries";
import { correctValuesInvalidation } from "@/server/correct-values/query-options";
import { type LimitsForm, limitsFormSchema } from "@/server/correct-values/schemas";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";

/** A test with what its edit action needs. */
export interface TestRow extends SimulationTestEntry {
  simulationId: string;
}

/** Returns one limit in words: a percentage, or a distance in the test's unit. */
function limitText(limits: AccuracyLimits, value: string, unit: string | null): string {
  const shown = formatDecimal(value);
  if (limits.kind === "percent") return m.correct_values_limit_percent({ value: shown });
  return unit ? m.correct_values_limit_absolute({ value: shown, unit }) : shown;
}

/**
 * A test's accuracy limits in words, or "No limits yet" with an icon (D13, WCAG 1.4.1). While the
 * simulation is prepared, a test without limits says in text that it blocks the start (#394).
 */
export function LimitsText({
  test,
  blocksStart,
}: Readonly<{ test: TestRow; blocksStart: boolean }>) {
  const { limits } = test;
  if (limits === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          blocksStart ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        {blocksStart ? m.correct_values_no_limits_blocks() : m.correct_values_no_limits()}
      </span>
    );
  }
  return (
    <span>
      {m.correct_values_limits_summary({
        yellow: limitText(limits, limits.yellow, test.unit),
        red: limitText(limits, limits.red, test.unit),
      })}
    </span>
  );
}

/** Opens the dialog that sets a test's accuracy limits; focus returns to the button. */
export function EditLimits({ test }: Readonly<{ test: TestRow }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontalIcon aria-hidden="true" data-icon="inline-start" />
        {m.correct_values_limits_set()}
        <span className="sr-only"> {m.correct_values_limits_for({ test: test.name })}</span>
      </Button>
      <LimitsDialog
        control={{
          open,
          onOpenChange: setOpen,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          },
        }}
        test={test}
      />
    </>
  );
}

function LimitsDialog({ control, test }: Readonly<{ control: DialogControl; test: TestRow }>) {
  const queryClient = useQueryClient();
  const call = useServerFn(setLimitsFn);
  const save = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      call,
      correctValuesInvalidation.limits(test.simulationId),
    ),
    { success: () => m.correct_values_limits_saved({ test: test.name }), toastErrors: false },
  );
  const initial: LimitsForm = test.limits
    ? {
        kind: test.limits.kind,
        yellow: formatDecimal(test.limits.yellow),
        red: formatDecimal(test.limits.red),
      }
    : { kind: "percent", yellow: "", red: "" };
  const kinds = LIMIT_KINDS.map((kind) => ({ value: kind, label: limitKindLabel(kind) }));
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: limitsFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({ ...value, simulationId: test.simulationId, testId: test.id });
      } catch (error) {
        applyServerRefusal(formApi, { form: simulationErrorMessage(simulationErrorCode(error)) });
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
              <DialogTitle>{m.correct_values_limits_title({ test: test.name })}</DialogTitle>
              <DialogDescription>
                {m.correct_values_limits_description()}{" "}
                {m.correct_values_limits_dialog_description()}
              </DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="kind">
                {(field) => (
                  <field.RadioGroupField label={m.correct_values_limit_kind()} options={kinds} />
                )}
              </form.AppField>
              <form.AppField name="yellow">
                {(field) => (
                  <field.TextField
                    label={m.correct_values_limit_yellow()}
                    description={m.correct_values_limit_yellow_help()}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="red">
                {(field) => (
                  <field.TextField
                    label={m.correct_values_limit_red()}
                    description={m.correct_values_limit_red_help()}
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
                {m.correct_values_limits_submit()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
