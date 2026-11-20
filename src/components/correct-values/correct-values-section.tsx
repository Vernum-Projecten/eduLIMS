// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EyeOffIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  AddCorrectValueForm,
  ChangeValueDialog,
  PasteCorrectValuesForm,
} from "@/components/correct-values/correct-value-forms";
import { CORRECT_VALUES_HEADING } from "@/components/correct-values/ids";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatDate, formatDecimal } from "@/lib/i18n/format";
import { removeCorrectValueFn } from "@/server/correct-values/functions";
import type { CorrectValueEntry, CorrectValuesPage } from "@/server/correct-values/queries";
import {
  correctValuesInvalidation,
  correctValuesQueryOptions,
} from "@/server/correct-values/query-options";
import { simulationMutationOptions } from "@/server/simulations/query-options";

/** A row of the table with the names its cells and actions need. */
interface ValueRow extends CorrectValueEntry {
  simulationId: string;
  testName: string;
  unit: string | null;
}

const helper = createDataTableColumnHelper<ValueRow>();

const columns = helper.columns([
  helper.accessor("sampleNumber", {
    id: "sampleNumber",
    header: () => m.correct_values_col_sample(),
    cell: ({ row }) => <span className="font-medium">{row.original.sampleNumber}</span>,
  }),
  helper.accessor("testName", {
    id: "test",
    header: () => m.correct_values_col_test(),
    cell: ({ row }) => row.original.testName,
  }),
  helper.accessor("value", {
    id: "value",
    header: () => m.correct_values_col_value(),
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDecimal(row.original.value)}
        {row.original.unit ? ` ${row.original.unit}` : ""}
      </span>
    ),
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    header: () => m.correct_values_col_changed(),
    cell: ({ row }) => (
      <time dateTime={row.original.updatedAt} className="whitespace-nowrap">
        {formatDate(row.original.updatedAt)}
      </time>
    ),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-24" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <ValueActions row={row.original} />,
  }),
]);

/**
 * The correct values of a simulation (D10, #267): one per sample number and test, entered once
 * for every lab and changeable in every state of the simulation. Teacher-scoped: the query
 * behind it refuses every other caller (Q-SIM-1).
 */
export function CorrectValuesSection({ simulationId }: Readonly<{ simulationId: string }>) {
  const { data: page, isFetching } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const rows = useMemo(() => valueRows(page), [page]);
  return (
    <section aria-labelledby={CORRECT_VALUES_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={CORRECT_VALUES_HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.correct_values_heading()}
        </h2>
        <p className="text-muted-foreground">{m.correct_values_description()}</p>
        <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
          <EyeOffIcon aria-hidden="true" className="size-4 shrink-0" />
          {m.correct_values_secret()}
        </p>
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.id}
        caption={m.correct_values_caption()}
        busy={isFetching}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.correct_values_empty_title()}</EmptyTitle>
              <EmptyDescription>{m.correct_values_empty_description()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <AddCorrectValueForm simulationId={simulationId} options={page.options} />
        <PasteCorrectValuesForm simulationId={simulationId} options={page.options} />
      </div>
    </section>
  );
}

function valueRows(page: CorrectValuesPage): ValueRow[] {
  const tests = new Map(page.tests.map((test) => [test.id, test]));
  return page.values.map((value) => {
    const test = tests.get(value.testId);
    return {
      ...value,
      simulationId: page.simulationId,
      testName: test?.name ?? "",
      unit: test?.unit ?? null,
    };
  });
}

function ValueActions({ row }: Readonly<{ row: ValueRow }>) {
  const [changing, setChanging] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const confirmation = useConfirmation(CORRECT_VALUES_HEADING);
  const queryClient = useQueryClient();
  const call = useServerFn(removeCorrectValueFn);
  const remove = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      call,
      correctValuesInvalidation.values(row.simulationId),
    ),
    {
      success: () => m.correct_values_removed({ sample: row.sampleNumber, test: row.testName }),
      onDone: confirmation.done,
      onFailed: confirmation.failed,
    },
  );
  const item = m.correct_values_item({ sample: row.sampleNumber, test: row.testName });
  return (
    <div className="flex gap-1">
      <Button
        ref={changeRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={m.correct_values_change({ item })}
        title={m.correct_values_change({ item })}
        onClick={() => setChanging(true)}
      >
        <PencilIcon aria-hidden="true" />
      </Button>
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={m.correct_values_remove({ item })}
        title={m.correct_values_remove({ item })}
        disabled={remove.isPending}
        onClick={confirmation.show}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
      <ChangeValueDialog
        control={{
          open: changing,
          onOpenChange: setChanging,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            changeRef.current?.focus();
          },
        }}
        row={row}
        item={item}
      />
      <ConfirmDialog
        confirmation={confirmation}
        title={m.correct_values_remove_title({ item })}
        body={m.correct_values_remove_body()}
        confirm={m.correct_values_remove_confirm()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ simulationId: row.simulationId, correctValueId: row.id })}
      />
    </div>
  );
}
