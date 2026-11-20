// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleDashedIcon, InfoIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { ListTable } from "@/components/simulations/list-table";
import { ToleranceDialog } from "@/components/tolerances/tolerance-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatDateTime, formatDecimal } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { StudentLabRow } from "@/server/simulations/queries";
import type { ToleranceEntry } from "@/server/tolerances/queries";
import { myTolerancesQueryOptions } from "@/server/tolerances/query-options";

const HEADING = "tolerances-heading";

/** A test row with what its edit action needs. */
interface Row extends ToleranceEntry {
  labId: string;
  editable: boolean;
}

const helper = createDataTableColumnHelper<Row>();

function Limit({ value }: Readonly<{ value: string | null }>) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
        {m.tolerances_none()}
      </span>
    );
  }
  return <span className="tabular-nums">{formatDecimal(value)}</span>;
}

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.tolerances_col_test(),
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium break-words">{row.original.name}</span>
        {row.original.unit ? (
          <span className="text-muted-foreground text-sm">{row.original.unit}</span>
        ) : null}
      </span>
    ),
  }),
  helper.display({
    id: "lower",
    header: () => m.tolerances_col_lower(),
    cell: ({ row }) => <Limit value={row.original.lower} />,
  }),
  helper.display({
    id: "upper",
    header: () => m.tolerances_col_upper(),
    cell: ({ row }) => (row.original.lower === null ? null : <Limit value={row.original.upper} />),
  }),
  helper.display({
    id: "changed",
    header: () => m.tolerances_col_changed(),
    cell: ({ row }) =>
      row.original.setAt ? (
        <time dateTime={row.original.setAt}>{formatDateTime(row.original.setAt)}</time>
      ) : null,
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => (row.original.editable ? <EditTolerance row={row.original} /> : null),
  }),
]);

function EditTolerance({ row }: Readonly<{ row: Row }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = m.tolerances_edit({ test: row.name });
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
      <ToleranceDialog
        // The form starts from the stored tolerance, so a new one (this member's or another's)
        // gives a fresh form.
        key={`${row.lower ?? ""}|${row.upper ?? ""}`}
        control={{
          open,
          onOpenChange: setOpen,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          },
        }}
        labId={row.labId}
        test={row}
      />
    </>
  );
}

/**
 * The links between the student's labs, when they are in more than one simulation; the lab on
 * screen carries `aria-current`, so the choice is not shown by colour alone (WCAG 1.4.1).
 */
export function LabPicker({
  labs,
  current,
}: Readonly<{ labs: readonly StudentLabRow[]; current: string }>) {
  if (labs.length < 2) return null;
  return (
    <nav aria-label={m.tolerances_lab_picker_label()}>
      <ul className="flex flex-wrap gap-2">
        {labs.map((lab) => (
          <li key={lab.labId}>
            <Button asChild variant={lab.labId === current ? "secondary" : "outline"} size="sm">
              <Link
                to="/student/tolerances"
                search={{ lab: lab.labId }}
                aria-current={lab.labId === current ? "page" : undefined}
                className={cn(lab.labId === current && "font-semibold")}
              >
                {m.tolerances_lab_option({ lab: lab.labName, simulation: lab.simulationName })}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The tolerances of one of the student's own labs (S13): per test the lab's own lower and upper
 * limit, set while its simulation runs. Nothing here comes from a teacher: no correct value, no
 * accuracy limit and no suggested tolerance (Q-SIM-1, W7).
 */
export function StudentTolerances({ labId }: Readonly<{ labId: string }>) {
  const { data: page, isFetching } = useSuspenseQuery(myTolerancesQueryOptions(labId));
  const editable = page.state === "running";
  const rows = useMemo(
    () => page.tests.map((test) => ({ ...test, labId: page.labId, editable })),
    [page, editable],
  );
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <h2 id={HEADING} className="text-lg font-semibold break-words">
        {m.tolerances_heading({ lab: page.labName })}
      </h2>
      {editable ? null : (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            {m.tolerances_not_running({ simulation: page.simulationName })}
          </AlertDescription>
        </Alert>
      )}
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.testId}
        caption={m.tolerances_caption({ lab: page.labName })}
        busy={isFetching}
        empty={
          <span className="flex flex-col gap-1">
            <span className="font-medium">{m.tolerances_empty_tests_title()}</span>
            <span className="text-muted-foreground">{m.tolerances_empty_tests_body()}</span>
          </span>
        }
      />
    </section>
  );
}
