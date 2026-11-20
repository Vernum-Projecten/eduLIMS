// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlertIcon, ClipboardPasteIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import type { GridStatus } from "@/components/correct-values/values-grid";
import { useAppForm } from "@/components/form/app-form";
import { ScrollRegion } from "@/components/lab-records/scroll-region";
import { PAGE_TITLE_ID } from "@/components/shell/page-header";
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
import { type GridProblem, type PastedGrid, parsePastedGrid } from "@/lib/correct-values";
import { parseDecimal } from "@/lib/decimal";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { type FormatOptions, formatDecimal, formatNumber } from "@/lib/i18n/format";
import { missingLimitsMessage, simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { setCorrectValuesFn } from "@/server/correct-values/functions";
import {
  correctValuesInvalidation,
  correctValuesQueryOptions,
} from "@/server/correct-values/query-options";
import {
  type GridPasteForm,
  gridPasteSchema,
  gridProblemMessage,
} from "@/server/correct-values/schemas";
import {
  refusedTestIds,
  simulationErrorCode,
  simulationMutationOptions,
} from "@/server/simulations/query-options";

/** The sentence a stored paste says: how many values it added, changed and left. */
function savedMessage(outcome: { added: number; changed: number; unchanged: number }): string {
  return m.correct_values_saved({
    added: formatNumber(outcome.added),
    changed: formatNumber(outcome.changed),
    unchanged: formatNumber(outcome.unchanged),
  });
}

/**
 * Returns a pasted value as it will be stored and shown, when that reads otherwise than the
 * pasted text: "1,5" is stored as 1.5, and in Dutch "1.234" shows as 1,234 (security review of
 * #408, S1). `null` when the two read the same or the text is no number.
 */
export function storedText(raw: string, options: FormatOptions = {}): string | null {
  const parsed = parseDecimal(raw);
  if (parsed === null) return null;
  const shown = formatDecimal(parsed, options);
  return shown === raw ? null : shown;
}

/** One pasted value, and beside it the value it will be stored as when the two differ. */
function PastedValue({ raw }: Readonly<{ raw: string }>) {
  const stored = storedText(raw);
  if (stored === null) return <>{raw}</>;
  return (
    <>
      {raw}{" "}
      <span className="text-muted-foreground">
        {m.correct_values_grid_stored_as({ value: stored })}
      </span>
    </>
  );
}

/** How many pasted rows the preview shows; the paste itself takes them all. */
const PREVIEW_ROWS = 100;

/** A problem of the preview, or the server's refusal of a test, as a mark with icon and text. */
function Problem({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="mt-1 flex items-start gap-1 font-normal text-destructive text-xs">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

/**
 * The pasted grid as it reads, before anything is stored (#401): each test name, sample number
 * and value in its place, and each part that does not read marked there with an icon and text
 * (WCAG 1.4.1, 3.3.1). A test the server refused (`missing_limits` while the simulation runs) is
 * marked at its header too.
 */
function PastePreview({
  grid,
  refusedTests,
}: Readonly<{ grid: PastedGrid; refusedTests: ReadonlyMap<string, string> }>) {
  const header = new Map<number, GridProblem>();
  const rows = new Map<number, GridProblem>();
  const cells = new Map<string, GridProblem>();
  for (const problem of grid.problems) {
    if (problem.kind === "header") header.set(problem.column, problem);
    else if (problem.kind === "row") rows.set(problem.row, problem);
    else if (problem.kind === "cell") cells.set(`${problem.row}:${problem.column}`, problem);
  }
  // The first rows, and every later row with a problem, so each problem shows (WCAG 3.3.1).
  const marked = new Set(
    grid.problems.flatMap((problem) =>
      problem.kind === "row" || problem.kind === "cell" ? [problem.row] : [],
    ),
  );
  const shown = grid.samples
    .map((sample, index) => ({ sample, row: index + 1 }))
    .filter(({ row }) => row <= PREVIEW_ROWS || marked.has(row));
  const hidden = grid.samples.length - shown.length;
  return (
    <ScrollRegion label={m.correct_values_grid_preview()}>
      <Table>
        <TableCaption className="sr-only">{m.correct_values_grid_preview()}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{m.correct_values_col_sample()}</TableHead>
            {grid.columns.map((column, index) => {
              const problem = header.get(index + 1);
              const refused = column.testId === null ? undefined : refusedTests.get(column.testId);
              return (
                <TableHead
                  // biome-ignore lint/suspicious/noArrayIndexKey: a pasted column is its position.
                  key={index}
                  scope="col"
                  className="whitespace-normal align-top"
                >
                  {column.text || "–"}
                  {problem && <Problem>{gridProblemMessage(problem)}</Problem>}
                  {refused && <Problem>{refused}</Problem>}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ sample, row }) => {
            const problem = rows.get(row);
            return (
              <TableRow key={row}>
                <TableHead scope="row" className="whitespace-normal align-top">
                  {sample.sampleNumber || "–"}
                  {problem && <Problem>{gridProblemMessage(problem)}</Problem>}
                </TableHead>
                {grid.columns.map((_column, cellIndex) => {
                  const cell = cells.get(`${row}:${cellIndex + 1}`);
                  return (
                    <TableCell
                      // biome-ignore lint/suspicious/noArrayIndexKey: a pasted cell is its position.
                      key={cellIndex}
                      className="whitespace-normal align-top tabular-nums"
                    >
                      <PastedValue raw={sample.cells[cellIndex] ?? ""} />
                      {cell && <Problem>{gridProblemMessage(cell)}</Problem>}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {hidden > 0 && (
        <p className="p-2 text-muted-foreground text-sm">
          {m.correct_values_grid_preview_more({ count: formatNumber(hidden) })}
        </p>
      )}
    </ScrollRegion>
  );
}

/**
 * The page's primary action, pasting a grid from a spreadsheet, and its dialog (#401). The page
 * shows `button` in its header once a test has a value and in the empty state before, and
 * `dialog` once; focus returns to whichever button is on screen, else to the page's `h1`
 * (WCAG 2.4.3). A saved paste is one write through the correct-value service: all or nothing.
 * An empty cell leaves a stored value as it is; a cell of the grid clears one.
 */
export function useGridPaste(
  simulationId: string,
  onSaved: (status: GridStatus) => void,
): { button: ReactNode; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return {
    button: (
      <Button ref={openerRef} type="button" onClick={() => setOpen(true)}>
        <ClipboardPasteIcon aria-hidden="true" data-icon="inline-start" />
        {m.correct_values_grid_paste_open()}
      </Button>
    ),
    dialog: (
      <GridPasteDialog
        simulationId={simulationId}
        open={open}
        onSaved={onSaved}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (openerRef.current ?? document.getElementById(PAGE_TITLE_ID))?.focus();
        }}
      />
    ),
  };
}

function GridPasteDialog({
  simulationId,
  open,
  onSaved,
  onOpenChange,
  onCloseAutoFocus,
}: Readonly<{
  simulationId: string;
  open: boolean;
  onSaved: (status: GridStatus) => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}>) {
  const { data: page } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  const tests = page.options;
  const schema = useMemo(() => gridPasteSchema(tests), [tests]);
  const [refusedTests, setRefusedTests] = useState<ReadonlyMap<string, string>>(new Map());
  const queryClient = useQueryClient();
  const call = useServerFn(setCorrectValuesFn);
  const save = useSimulationAction(
    simulationMutationOptions(queryClient, call, correctValuesInvalidation.values(simulationId)),
    {
      success: null,
      toastErrors: false,
    },
  );
  const form = useAppForm({
    defaultValues: { text: "" } satisfies GridPasteForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value, formApi }) => {
      setRefusedTests(new Map());
      const { rows } = parsePastedGrid(value.text, tests);
      try {
        const outcome = await save.mutateAsync({ simulationId, rows });
        onSaved({ message: savedMessage(outcome) });
      } catch (error) {
        const code = simulationErrorCode(error);
        const names = new Map(tests.map((test) => [test.id, test.name]));
        if (code === "missing_limits") {
          // A running simulation takes values only for tests with limits: marked at each header.
          const message = missingLimitsMessage(refusedTestIds(error), names);
          setRefusedTests(new Map(refusedTestIds(error).map((id) => [id, message])));
          applyServerRefusal(formApi, { fields: { text: message } });
          return;
        }
        applyServerRefusal(formApi, { form: simulationErrorMessage(code) });
        return;
      }
      formApi.reset();
      onOpenChange(false);
    },
  });
  const text = useStore(form.store, (state) => state.values.text);
  const grid = useMemo(() => parsePastedGrid(text, tests), [text, tests]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset();
          setRefusedTests(new Map());
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          noValidate
          aria-label={m.correct_values_grid_paste_form()}
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <DialogHeader>
              <DialogTitle>{m.correct_values_grid_paste_title()}</DialogTitle>
              <DialogDescription>{m.correct_values_grid_paste_description()}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="text">
                {(field) => (
                  <field.TextareaField
                    label={m.correct_values_grid_paste_label()}
                    description={m.correct_values_grid_paste_help()}
                    rows={6}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            {grid.columns.length > 0 && <PastePreview grid={grid} refusedTests={refusedTests} />}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.simulations_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton
                icon={<ClipboardPasteIcon aria-hidden="true" data-icon="inline-start" />}
              >
                {m.correct_values_grid_paste_submit()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
