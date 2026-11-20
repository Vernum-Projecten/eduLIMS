// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TableIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { EditLimits, LimitsText, type TestRow } from "@/components/correct-values/limits-dialog";
import { useAppForm } from "@/components/form/app-form";
import { ScrollRegion } from "@/components/lab-records/scroll-region";
import { PAGE_TITLE_ID } from "@/components/shell/page-frame";
import { focusById } from "@/components/simulations/focus";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
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

/** What the page's status line says after a save, and how to take a clear back (WCAG 3.3.4). */
export interface GridStatus {
  message: string;
  undo?: () => Promise<void>;
}

/** The id of the grid's one-line instruction, which every cell editor names too. */
const GRID_HELP = "values-grid-help";
/** The id of the grid's scroll region, where focus goes when the cell it had is gone. */
const GRID_REGION = "values-grid";

/** Returns the key of a sample number and a test, the sample number regardless of case. */
function cellKey(sampleNumber: string, testId: string): string {
  return `${sampleNumber.toLowerCase()}\u0000${testId}`;
}

/** Returns the id of the button of a cell. */
function cellId(row: number, column: number): string {
  return `values-grid-cell-${row}-${column}`;
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

/** A cell by its position. */
interface Position {
  row: number;
  column: number;
}

/** Returns the cell a key moves to from `at`, or `null` for a key the grid does not take. */
export function nextCell(
  key: string,
  at: Position,
  rows: number,
  columns: number,
): Position | null {
  const clamp = (value: number, size: number) => Math.min(Math.max(value, 0), size - 1);
  switch (key) {
    case "ArrowUp":
      return { row: clamp(at.row - 1, rows), column: at.column };
    case "ArrowDown":
      return { row: clamp(at.row + 1, rows), column: at.column };
    case "ArrowLeft":
      return { row: at.row, column: clamp(at.column - 1, columns) };
    case "ArrowRight":
      return { row: at.row, column: clamp(at.column + 1, columns) };
    case "Home":
      return { row: at.row, column: 0 };
    case "End":
      return { row: at.row, column: columns - 1 };
    default:
      return null;
  }
}

/** Where focus goes after a write: the same sample and test when they are still there. */
interface Pending {
  sampleKey: string;
  testId: string;
  at: Position;
}

/**
 * The correct values of a simulation as one grid (D10, D13, #401): its sample numbers as rows,
 * the tests it uses as columns with their accuracy limits in a second header row, the correct
 * value in each cell; an empty cell holds no correct value. The grid is one Tab stop: the arrow
 * keys, Home and End move between the cells (a roving tabindex), Enter edits a cell, Enter saves,
 * Escape or leaving the cell cancels, and saving it empty clears the value, with Undo in the
 * page's status line (WCAG 2.1.1, 3.3.4). It scrolls in a named region (WCAG 1.4.10).
 * Teacher-scoped: the read behind it refuses every other caller (Q-SIM-1).
 */
export function ValuesGrid({
  simulationId,
  emptyAction,
  onSaved,
}: Readonly<{
  simulationId: string;
  emptyAction: ReactNode;
  /** Takes what a saved or cleared cell says, for the page's status line (WCAG 4.1.3). */
  onSaved: (status: GridStatus) => void;
}>) {
  const { data: page, isFetching } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const grid = useMemo(() => gridOf(page), [page]);
  const [active, setActive] = useState<Position>({ row: 0, column: 0 });
  const [editing, setEditing] = useState<Position | null>(null);
  const pending = useRef<Pending | null>(null);
  const queryClient = useQueryClient();
  const callSet = useServerFn(setCorrectValuesFn);
  const restore = useSimulationAction(
    simulationMutationOptions(queryClient, callSet, correctValuesInvalidation.values(simulationId)),
    { success: null },
  );
  const rows = grid.samples.length;
  const columns = grid.tests.length;
  const current = {
    row: Math.min(active.row, Math.max(rows - 1, 0)),
    column: Math.min(active.column, Math.max(columns - 1, 0)),
  };

  // After a write the grid reads anew: focus stays on the sample and test it was on, or moves
  // to the nearest cell when its row or column went, or to the region when no cell is left
  // (WCAG 2.4.3).
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    const row = grid.samples.findIndex((sample) => sample.toLowerCase() === target.sampleKey);
    const column = grid.tests.findIndex((test) => test.id === target.testId);
    if (rows === 0 || columns === 0) {
      focusById(GRID_REGION);
      if (document.activeElement?.id !== GRID_REGION) focusById(PAGE_TITLE_ID);
      return;
    }
    const next = {
      row: row >= 0 ? row : Math.min(target.at.row, rows - 1),
      column: column >= 0 ? column : Math.min(target.at.column, columns - 1),
    };
    setActive(next);
    focusById(cellId(next.row, next.column));
  }, [grid, rows, columns]);

  const close = useCallback((at: Position, refocus: boolean) => {
    setEditing(null);
    if (refocus) requestAnimationFrame(() => focusById(cellId(at.row, at.column)));
  }, []);

  if (columns === 0 || rows === 0) {
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

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: Position) => {
    const next = nextCell(event.key, at, rows, columns);
    if (!next) return;
    event.preventDefault();
    setActive(next);
    focusById(cellId(next.row, next.column));
  };

  return (
    <div className="flex flex-col gap-2" aria-busy={isFetching}>
      <p id={GRID_HELP} className="text-muted-foreground text-sm">
        {m.correct_values_grid_help()}
      </p>
      <ScrollRegion id={GRID_REGION} label={m.correct_values_grid_region()}>
        <Table>
          <TableCaption className="sr-only">{m.correct_values_grid_caption()}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="sticky left-0 bg-background">
                {m.correct_values_col_sample()}
              </TableHead>
              {grid.tests.map((test) => (
                <TableHead key={test.id} scope="col" className="min-w-40 whitespace-normal">
                  <span className="font-semibold">{test.name}</span>
                  {test.unit && (
                    <span className="font-normal text-muted-foreground"> ({test.unit})</span>
                  )}
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              <TableHead scope="row" className="sticky left-0 bg-background font-normal">
                {m.correct_values_grid_limits_row()}
              </TableHead>
              {grid.tests.map((test) => (
                <TableHead
                  key={test.id}
                  className="whitespace-normal py-2 align-top font-normal text-xs"
                >
                  <div className="flex flex-col items-start gap-1.5">
                    <LimitsText test={test} blocksStart={false} />
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
                {grid.tests.map((test, column) => {
                  const at = { row, column };
                  const entry = grid.cells.get(cellKey(sampleNumber, test.id)) ?? null;
                  const name = m.correct_values_grid_cell({
                    test: test.name,
                    sample: sampleNumber,
                  });
                  const isEditing = editing?.row === row && editing.column === column;
                  return (
                    <TableCell key={test.id} className="scroll-ml-32 p-1">
                      {isEditing ? (
                        <CellEditor
                          simulationId={simulationId}
                          sampleNumber={sampleNumber}
                          test={test}
                          entry={entry}
                          fieldId={`${cellId(row, column)}-field`}
                          onClose={(refocus) => close(at, refocus)}
                          onWritten={(written) => {
                            const here = {
                              sampleKey: sampleNumber.toLowerCase(),
                              testId: test.id,
                              at,
                            };
                            pending.current = here;
                            setEditing(null);
                            const { cleared } = written;
                            onSaved({
                              message: written.message,
                              ...(cleared && {
                                undo: async () => {
                                  await restore.mutateAsync({ simulationId, rows: [cleared.row] });
                                  pending.current = here;
                                  onSaved({ message: cleared.restored });
                                },
                              }),
                            });
                          }}
                        />
                      ) : (
                        <Button
                          id={cellId(row, column)}
                          type="button"
                          variant="ghost"
                          tabIndex={current.row === row && current.column === column ? 0 : -1}
                          aria-label={`${name}: ${
                            entry
                              ? `${formatDecimal(entry.value)}${test.unit ? ` ${test.unit}` : ""}`
                              : m.correct_values_grid_no_value()
                          }`}
                          className="w-full justify-start tabular-nums"
                          onFocus={() => setActive(at)}
                          onClick={() => {
                            setActive(at);
                            setEditing(at);
                          }}
                          onKeyDown={(event) => onKeyDown(event, at)}
                        >
                          {entry ? (
                            `${formatDecimal(entry.value)}${test.unit ? ` ${test.unit}` : ""}`
                          ) : (
                            <span aria-hidden="true" className="text-muted-foreground">
                              –
                            </span>
                          )}
                        </Button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollRegion>
    </div>
  );
}

/** What a cell write says, and for a clear the value and the words that put it back. */
interface Written {
  message: string;
  cleared?: {
    row: { sampleNumber: string; testId: string; value: string };
    restored: string;
  };
}

/** What one cell edits: the value in the schema's decimal check, or empty to clear it. */
const cellSchema = z.object({
  value: z
    .string()
    .trim()
    .refine((value) => value === "" || parseDecimal(value) !== null, {
      error: () => m.correct_values_number_invalid(),
    }),
});

function CellEditor({
  simulationId,
  sampleNumber,
  test,
  entry,
  fieldId,
  onClose,
  onWritten,
}: Readonly<{
  simulationId: string;
  sampleNumber: string;
  test: TestRow;
  entry: CorrectValueEntry | null;
  fieldId: string;
  onClose: (refocus: boolean) => void;
  onWritten: (written: Written) => void;
}>) {
  const queryClient = useQueryClient();
  const callSet = useServerFn(setCorrectValuesFn);
  const callRemove = useServerFn(removeCorrectValueFn);
  const keys = correctValuesInvalidation.values(simulationId);
  // The page's status line is the one channel these writes speak through: no toast too.
  const save = useSimulationAction(simulationMutationOptions(queryClient, callSet, keys), {
    success: null,
    toastErrors: false,
  });
  const remove = useSimulationAction(simulationMutationOptions(queryClient, callRemove, keys), {
    success: null,
    toastErrors: false,
  });
  // The field takes focus as the cell opens, its text selected to type over (WCAG 2.4.3).
  useEffect(() => {
    focusById(fieldId);
    const input = document.getElementById(fieldId);
    if (input instanceof HTMLInputElement) input.select();
  }, [fieldId]);
  const unit = test.unit ? ` ${test.unit}` : "";
  const initial = { value: entry ? formatDecimal(entry.value) : "" };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: cellSchema },
    onSubmit: async ({ value, formApi }) => {
      const typed = value.value.trim();
      const names = { test: test.name, sample: sampleNumber };
      try {
        if (typed === "" && entry) {
          await remove.mutateAsync({ simulationId, correctValueId: entry.id });
          const old = `${formatDecimal(entry.value)}${unit}`;
          onWritten({
            message: m.correct_values_grid_cleared({ ...names, value: old }),
            cleared: {
              row: { sampleNumber, testId: test.id, value: entry.value },
              restored: m.correct_values_grid_restored({ ...names, value: old }),
            },
          });
          return;
        }
        if (typed === "") {
          onClose(true);
          return;
        }
        await save.mutateAsync({
          simulationId,
          rows: [{ sampleNumber, testId: test.id, value: typed }],
        });
        const stored = parseDecimal(typed);
        onWritten({
          message: m.correct_values_grid_saved({
            ...names,
            value: `${stored === null ? typed : formatDecimal(stored)}${unit}`,
          }),
        });
      } catch (error) {
        const code = simulationErrorCode(error);
        const missing = code === "missing_limits";
        // The refusal stays at the field, which keeps focus (WCAG 3.3.1).
        applyServerRefusal(
          formApi,
          missing || code === "test_retired" || code === "test_not_found"
            ? {
                fields: {
                  value: missing
                    ? missingLimitsMessage(refusedTestIds(error), new Map([[test.id, test.name]]))
                    : simulationErrorMessage(code),
                },
              }
            : { form: simulationErrorMessage(code) },
        );
      }
    },
  });
  return (
    <form
      noValidate
      className="min-w-32"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(true);
      }}
      onBlur={(event) => {
        // Leaving the cell for anything outside its editor cancels the edit.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        onClose(false);
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <form.AppField name="value">
          {(field) => (
            // The column and the row header label the cell on screen; the field's own label
            // names both for a screen reader, and its description is the grid's instruction
            // (WCAG 1.3.1, 2.5.3, 3.3.2).
            <field.TextField
              id={fieldId}
              label={m.correct_values_grid_edit_label({ test: test.name, sample: sampleNumber })}
              description={m.correct_values_grid_help()}
              className="gap-1 [&_[data-slot=field-description]]:sr-only [&_[data-slot=field-label]]:sr-only"
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </form.AppField>
      </form.AppForm>
    </form>
  );
}
