// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlertIcon, SaveIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { LIMITS_HEADING } from "@/components/correct-values/ids";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { useAppForm } from "@/components/form/app-form";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
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
import { setLimitsFn } from "@/server/correct-values/functions";
import type { SimulationTestEntry } from "@/server/correct-values/queries";
import {
  correctValuesInvalidation,
  correctValuesQueryOptions,
} from "@/server/correct-values/query-options";
import { type LimitsForm, limitsFormSchema } from "@/server/correct-values/schemas";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";

/** A test row with what its edit action needs. */
interface TestRow extends SimulationTestEntry {
  simulationId: string;
}

/** Returns one limit in words: a percentage, or a distance in the test's unit. */
function limitText(limits: AccuracyLimits, value: string, unit: string | null): string {
  const shown = formatDecimal(value);
  if (limits.kind === "percent") return m.correct_values_limit_percent({ value: shown });
  return unit ? m.correct_values_limit_absolute({ value: shown, unit }) : shown;
}

const helper = createDataTableColumnHelper<TestRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.correct_values_col_test(),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  helper.accessor("values", {
    id: "values",
    header: () => m.correct_values_col_count(),
    cell: ({ row }) => <span className="tabular-nums">{row.original.values}</span>,
  }),
  helper.display({
    id: "limits",
    header: () => m.correct_values_col_limits(),
    cell: ({ row }) => <LimitsText test={row.original} />,
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <EditLimits test={row.original} />,
  }),
]);

function LimitsText({ test }: Readonly<{ test: TestRow }>) {
  const { limits } = test;
  if (limits === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        {m.correct_values_no_limits()}
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

/**
 * The accuracy limits of each test the simulation uses (D13): how far a result may be from the
 * correct value before it turns yellow, and before it turns red. Teacher-scoped (Q-SIM-1).
 */
export function LimitsSection({ simulationId }: Readonly<{ simulationId: string }>) {
  const { data: page, isFetching } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const rows = useMemo(
    () => page.tests.map((test) => ({ ...test, simulationId: page.simulationId })),
    [page],
  );
  return (
    <section aria-labelledby={LIMITS_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={LIMITS_HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.correct_values_limits_heading()}
        </h2>
        <p className="text-muted-foreground">{m.correct_values_limits_description()}</p>
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.id}
        caption={m.correct_values_limits_caption()}
        busy={isFetching}
        empty={m.correct_values_limits_empty()}
      />
    </section>
  );
}

function EditLimits({ test }: Readonly<{ test: TestRow }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = m.correct_values_limits_edit({ test: test.name });
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontalIcon aria-hidden="true" />
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
              <DialogDescription>{m.correct_values_limits_dialog_description()}</DialogDescription>
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
