// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TableIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { EditLimits, LimitsText, type TestRow } from "@/components/correct-values/limits-dialog";
import { useAppForm } from "@/components/form/app-form";
import { ScrollRegion } from "@/components/lab-records/scroll-region";
import { focusById } from "@/components/simulations/focus";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { parseDecimal } from "@/lib/decimal";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatDecimal } from "@/lib/i18n/format";
import { missingLimitsMessage, simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { removeCorrectValueFn, setCorrectValuesFn } from "@/server/correct-values/functions";
import type { CorrectValueEntry, CorrectValuesPage } from "@/server/correct-values/queries";
import {
  correctValuesInvalidation,
  correctValuesQueryOptions,
} from "@/server/correct-values/query-options";
import {
  refusedTestIds,
  simulationErrorCode,
  simulationMutationOptions,
} from "@/server/simulations/query-options";

/** Returns the key of a sample number and a test, the sample number regardless of case. */
function cellKey(sampleNumber: string, testId: string): string {
  return `${sampleNumber.toLowerCase()}\u0000${testId}`;
}

/** The grid of a simulation: its tests as columns, its sample numbers as rows, values by cell. */
interface Grid {
  tests: TestRow[];
  samples: string[];
  cells: Map<string, CorrectValueEntry>;
}

function gridOf(page: CorrectValuesPage): Grid {
  const samples: string[] = [];
  const seen = new Set<string>();
  const cells = new Map<string, CorrectValueEntry>();
  for (const value of page.values) {
    const key = value.sampleNumber.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      samples.push(value.sampleNumber);
    }
    cells.set(cellKey(value.sampleNumber, value.testId), value);
  }
  const tests = page.tests.map((test) => ({ ...test, simulationId: page.simulationId }));
  return { tests, samples, cells };
}

/** Moves focus to the cell beside `from` in the direction of an arrow key (WCAG 2.1.1). */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>, row: number, column: number): void {
  const step: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const move = step[event.key];
  if (!move) return;
  const table = event.currentTarget.closest("table");
  const target = table?.querySelector<HTMLButtonElement>(
    `[data-grid-cell][data-row="${row + move[0]}"][data-column="${column + move[1]}"]`,
  );
  if (!target) return;
  event.preventDefault();
  target.focus();
}

/**
 * The correct values of a simulation as one grid (D10, D13, #401): its sample numbers as rows,
 * the tests it uses as columns with their accuracy limits in the header, the correct value in
 * each cell; an empty cell means the test is not requested for that sample. Each cell is a
 * button named by its test and sample; Enter edits it, Enter saves, Escape cancels, and the
 * arrow keys move between cells. The grid scrolls in a named region (WCAG 1.4.10, 2.1.1).
 * Teacher-scoped: the read behind it refuses every other caller (Q-SIM-1).
 */
export function ValuesGrid({
  simulationId,
  emptyAction,
  onSaved,
}: Readonly<{
  simulationId: string;
  emptyAction: ReactNode;
  /** Takes the sentence a saved or cleared cell says, for the page's status line (WCAG 4.1.3). */
  onSaved: (message: string) => void;
}>) {
  const { data: page, isFetching } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const grid = useMemo(() => gridOf(page), [page]);
  const prepared = page.state === "prepared";
  if (grid.tests.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TableIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{m.correct_values_empty_title()}</EmptyTitle>
          <EmptyDescription>{m.correct_values_grid_empty()}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{emptyAction}</EmptyContent>
      </Empty>
    );
  }
  return (
    <div aria-busy={isFetching}>
      <ScrollRegion label={m.correct_values_grid_region()}>
        <Table>
          <TableCaption className="sr-only">{m.correct_values_grid_caption()}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="sticky left-0 bg-background align-bottom">
                {m.correct_values_col_sample()}
              </TableHead>
              {grid.tests.map((test) => (
                <TableHead
                  key={test.id}
                  scope="col"
                  className="min-w-48 whitespace-normal py-2 align-top"
                >
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="font-semibold">
                      {test.name}
                      {test.unit && (
                        <span className="font-normal text-muted-foreground"> ({test.unit})</span>
                      )}
                    </span>
                    <span className="font-normal text-xs">
                      <LimitsText test={test} blocksStart={prepared} />
                    </span>
                    <EditLimits test={test} />
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grid.samples.map((sampleNumber, row) => (
              <TableRow key={sampleNumber.toLowerCase()}>
                <TableHead
                  scope="row"
                  className="sticky left-0 bg-background font-medium whitespace-nowrap"
                >
                  {sampleNumber}
                </TableHead>
                {grid.tests.map((test, column) => (
                  <TableCell key={test.id} className="p-1">
                    <ValueCell
                      simulationId={simulationId}
                      sampleNumber={sampleNumber}
                      test={test}
                      entry={grid.cells.get(cellKey(sampleNumber, test.id)) ?? null}
                      row={row}
                      column={column}
                      onSaved={onSaved}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollRegion>
    </div>
  );
}

/** What one cell edits: the value in the schema's decimal check, or empty for not requested. */
const cellSchema = z.object({
  value: z
    .string()
    .trim()
    .refine((value) => value === "" || parseDecimal(value) !== null, {
      error: () => m.correct_values_number_invalid(),
    }),
});

function ValueCell({
  simulationId,
  sampleNumber,
  test,
  entry,
  row,
  column,
  onSaved,
}: Readonly<{
  simulationId: string;
  sampleNumber: string;
  test: TestRow;
  entry: CorrectValueEntry | null;
  row: number;
  column: number;
  onSaved: (message: string) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const cellRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      cellRef.current?.focus();
    }
  }, [editing]);
  const close = () => {
    returnFocus.current = true;
    setEditing(false);
  };
  const shown = entry
    ? `${formatDecimal(entry.value)}${test.unit ? ` ${test.unit}` : ""}`
    : m.correct_values_grid_not_requested();
  const name = m.correct_values_grid_cell({ test: test.name, sample: sampleNumber });
  if (editing) {
    return (
      <CellEditor
        simulationId={simulationId}
        sampleNumber={sampleNumber}
        test={test}
        entry={entry}
        label={name}
        fieldId={`grid-cell-${row}-${column}`}
        onClose={close}
        onSaved={onSaved}
      />
    );
  }
  return (
    <button
      ref={cellRef}
      type="button"
      data-grid-cell=""
      data-row={row}
      data-column={column}
      aria-label={`${name}: ${shown}`}
      className="flex min-h-9 w-full items-center rounded-md px-2 text-left tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={() => setEditing(true)}
      onKeyDown={(event) => moveFocus(event, row, column)}
    >
      {entry ? (
        shown
      ) : (
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
      )}
    </button>
  );
}

function CellEditor({
  simulationId,
  sampleNumber,
  test,
  entry,
  label,
  fieldId,
  onClose,
  onSaved,
}: Readonly<{
  simulationId: string;
  sampleNumber: string;
  test: TestRow;
  entry: CorrectValueEntry | null;
  label: string;
  fieldId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}>) {
  const queryClient = useQueryClient();
  const callSet = useServerFn(setCorrectValuesFn);
  const callRemove = useServerFn(removeCorrectValueFn);
  const keys = correctValuesInvalidation.values(simulationId);
  const save = useSimulationAction(simulationMutationOptions(queryClient, callSet, keys), {
    success: () => m.correct_values_grid_saved({ test: test.name, sample: sampleNumber }),
    toastErrors: false,
  });
  const remove = useSimulationAction(simulationMutationOptions(queryClient, callRemove, keys), {
    success: () => m.correct_values_grid_cleared({ test: test.name, sample: sampleNumber }),
    toastErrors: false,
  });
  // The field takes focus as the cell opens, its text selected to type over (WCAG 2.4.3).
  useEffect(() => {
    focusById(fieldId);
    const input = document.getElementById(fieldId);
    if (input instanceof HTMLInputElement) input.select();
  }, [fieldId]);
  const initial = { value: entry ? formatDecimal(entry.value) : "" };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: cellSchema },
    onSubmit: async ({ value, formApi }) => {
      const typed = value.value.trim();
      try {
        if (typed === "" && entry) {
          await remove.mutateAsync({ simulationId, correctValueId: entry.id });
          onSaved(m.correct_values_grid_cleared({ test: test.name, sample: sampleNumber }));
        } else if (typed !== "") {
          await save.mutateAsync({
            simulationId,
            rows: [{ sampleNumber, testId: test.id, value: typed }],
          });
          onSaved(m.correct_values_grid_saved({ test: test.name, sample: sampleNumber }));
        }
      } catch (error) {
        const code = simulationErrorCode(error);
        const names = new Map([[test.id, test.name]]);
        applyServerRefusal(formApi, {
          fields: {
            value:
              code === "missing_limits"
                ? missingLimitsMessage(refusedTestIds(error), names)
                : simulationErrorMessage(code),
          },
        });
        return;
      }
      onClose();
    },
  });
  return (
    <form
      noValidate
      aria-label={label}
      className="min-w-32"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <form.AppForm>
        <form.AppField name="value">
          {(field) => (
            // The column and the row header label the cell on screen; the field's own label
            // names both for a screen reader (WCAG 1.3.1, 2.5.3).
            <field.TextField
              id={fieldId}
              label={m.correct_values_grid_edit_label({ test: test.name, sample: sampleNumber })}
              className="gap-1 [&_[data-slot=field-label]]:sr-only"
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </form.AppField>
      </form.AppForm>
    </form>
  );
}
