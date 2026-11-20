// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardPasteIcon, PencilIcon, PlusIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  AddCorrectValueDialog,
  ChangeValueDialog,
  PasteCorrectValuesDialog,
} from "@/components/correct-values/correct-value-forms";
import { EditLimits, LimitsText, type TestRow } from "@/components/correct-values/limits-dialog";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { PAGE_TITLE_ID } from "@/components/shell/page-header";
import { RowActions } from "@/components/shell/row-actions";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { ListTable } from "@/components/simulations/list-table";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatDate, formatDecimal } from "@/lib/i18n/format";
import { removeCorrectValueFn } from "@/server/correct-values/functions";
import type { CorrectValueEntry, CorrectValuesPage } from "@/server/correct-values/queries";
import {
  correctValuesInvalidation,
  correctValuesQueryOptions,
} from "@/server/correct-values/query-options";
import { simulationMutationOptions } from "@/server/simulations/query-options";

/** A row of a test's table with the names its cells and actions need. */
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
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <ValueActions row={row.original} />,
  }),
]);

/** One test of the simulation with its limits and its correct values. */
interface TestGroup {
  test: TestRow;
  rows: ValueRow[];
}

function groupsOf(page: CorrectValuesPage): TestGroup[] {
  return page.tests.map((test) => ({
    test: { ...test, simulationId: page.simulationId },
    rows: page.values
      .filter((value) => value.testId === test.id)
      .map((value) => ({
        ...value,
        simulationId: page.simulationId,
        testName: test.name,
        unit: test.unit,
      })),
  }));
}

/**
 * The correct values of a simulation, one table per test with that test's accuracy limits above
 * it (D10, D13, #381): a value per sample number, entered once for every lab and changeable in
 * every state. Teacher-scoped: the query behind it refuses every other caller (Q-SIM-1).
 */
export function ValuesByTest({ simulationId }: Readonly<{ simulationId: string }>) {
  const { data: page, isFetching } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const groups = useMemo(() => groupsOf(page), [page]);
  if (groups.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TargetIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{m.correct_values_empty_title()}</EmptyTitle>
          <EmptyDescription>{m.correct_values_empty_next()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      {groups.map(({ test, rows }) => (
        <TestSection key={test.id} test={test} rows={rows} busy={isFetching} />
      ))}
    </div>
  );
}

function TestSection({
  test,
  rows,
  busy,
}: Readonly<{ test: TestRow; rows: ValueRow[]; busy: boolean }>) {
  const headingId = `test-${test.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="break-words font-semibold text-lg">
            {test.name}
            {test.unit && <span className="font-normal text-muted-foreground"> ({test.unit})</span>}
          </h2>
          <p className="text-sm">
            <span className="text-muted-foreground">{m.correct_values_col_limits()}: </span>
            <LimitsText test={test} />
          </p>
        </div>
        <EditLimits test={test} />
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.id}
        caption={m.correct_values_test_caption({ test: test.name })}
        busy={busy}
        empty={m.correct_values_test_empty()}
      />
    </section>
  );
}

/** The page's actions: entering one value is primary, pasting rows secondary (#384). */
export function CorrectValueActions({
  simulationId,
  primary,
}: Readonly<{ simulationId: string; primary: boolean }>) {
  const { data: page } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const pasteRef = useRef<HTMLButtonElement>(null);
  if (primary) {
    return (
      <>
        <Button ref={addRef} type="button" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.correct_values_add_open()}
        </Button>
        <AddCorrectValueDialog
          control={{
            open: adding,
            onOpenChange: setAdding,
            onCloseAutoFocus: (event) => {
              event.preventDefault();
              addRef.current?.focus();
            },
          }}
          simulationId={simulationId}
          options={page.options}
        />
      </>
    );
  }
  return (
    <>
      <Button ref={pasteRef} type="button" variant="outline" onClick={() => setPasting(true)}>
        <ClipboardPasteIcon aria-hidden="true" data-icon="inline-start" />
        {m.correct_values_paste_open()}
      </Button>
      <PasteCorrectValuesDialog
        control={{
          open: pasting,
          onOpenChange: setPasting,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            pasteRef.current?.focus();
          },
        }}
        simulationId={simulationId}
        options={page.options}
      />
    </>
  );
}

function ValueActions({ row }: Readonly<{ row: ValueRow }>) {
  const [changing, setChanging] = useState(false);
  // The menu is gone when a dialog closes: focus returns to its button, or after a removal to
  // the page's h1, since the row goes (WCAG 2.4.3).
  const confirmation = useConfirmation(PAGE_TITLE_ID);
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
    <>
      <RowActions
        label={m.data_table_row_actions({ name: item })}
        triggerRef={confirmation.triggerRef}
      >
        <DropdownMenuItem onSelect={() => setChanging(true)}>
          <PencilIcon aria-hidden="true" />
          {m.correct_values_change_short()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={remove.isPending}
          onSelect={confirmation.show}
        >
          <Trash2Icon aria-hidden="true" />
          {m.correct_values_remove_short()}
        </DropdownMenuItem>
      </RowActions>
      <ChangeValueDialog
        control={{
          open: changing,
          onOpenChange: setChanging,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            confirmation.triggerRef.current?.focus();
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
    </>
  );
}
