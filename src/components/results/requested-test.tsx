// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  FileCheckIcon,
  FlaskConicalIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { ScrollRegion } from "@/components/lab-records/scroll-region";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDateTime, formatDecimal } from "@/lib/i18n/format";
import {
  measurementSourceLabel,
  patientRecordLabel,
  requestedTestStateLabel,
} from "@/lib/i18n/results-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { PatientRecordState, RequestedTestState } from "@/lib/results";
import { cn } from "@/lib/utils";
import type { MeasurementRow, RequestedTestRow } from "@/server/results/queries";

/** The state of a requested test as a badge with an icon and text, never colour alone. */
export function TestStateBadge({ state }: Readonly<{ state: RequestedTestState }>) {
  const icon =
    state === "released" ? (
      <CircleCheckIcon aria-hidden="true" data-icon="inline-start" />
    ) : state === "measured" ? (
      <FlaskConicalIcon aria-hidden="true" data-icon="inline-start" />
    ) : (
      <CircleDashedIcon aria-hidden="true" data-icon="inline-start" />
    );
  return (
    <Badge variant={state === "released" ? "default" : "outline"}>
      {icon}
      {requestedTestStateLabel(state)}
    </Badge>
  );
}

/** The mark of the released measurement, the one that counts (D11): an icon and text. */
export function ReleasedMark() {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
      {m.results_released_mark()}
    </span>
  );
}

/** What the student can do with a requested test; the teacher's view passes none. */
export interface RequestedTestActions {
  /** The student's lab, for the link to its tolerances. */
  labId: string;
  /** Whether the team can write: the simulation runs and the test is not released. */
  writable: boolean;
  onMeasure: (event: MouseEvent<HTMLButtonElement>) => void;
  onRelease: (event: MouseEvent<HTMLButtonElement>, measurement: MeasurementRow) => void;
}

/** A tolerance as a range in the test's unit. */
function Range({ lower, upper, unit }: Readonly<{ lower: string; upper: string; unit: string }>) {
  return (
    <span className="tabular-nums">
      {m.results_tolerance_range({
        lower: formatDecimal(lower),
        upper: formatDecimal(upper),
        unit,
      })}
    </span>
  );
}

/**
 * Where a released result stands in the patient's record (#148), with an icon and text, never
 * colour alone (WCAG 1.4.1); nothing for a control request, which has no patient (S16).
 */
function PatientRecord({ state }: Readonly<{ state: PatientRecordState }>) {
  const label = patientRecordLabel(state);
  if (label === null) return null;
  const Icon = state === "written" ? FileCheckIcon : ClockIcon;
  return (
    <>
      <dt className="text-muted-foreground">{m.results_record()}</dt>
      <dd className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span>{label}</span>
      </dd>
    </>
  );
}

/** The team's own tolerance and the release, or what the test lacks for a release (S13, S15). */
function ReleaseFacts({ test, labId }: Readonly<{ test: RequestedTestRow; labId: string | null }>) {
  const unit = test.unit ?? "";
  if (test.release) {
    return (
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{m.results_released_at()}</dt>
        <dd>
          <time dateTime={test.release.releasedAt}>{formatDateTime(test.release.releasedAt)}</time>
        </dd>
        <dt className="text-muted-foreground">{m.results_release_tolerance()}</dt>
        <dd>
          <Range {...test.release.tolerance} unit={unit} />
        </dd>
        <PatientRecord state={test.release.record} />
      </dl>
    );
  }
  if (test.tolerance) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{m.results_your_tolerance()} </span>
        <Range {...test.tolerance} unit={unit} />
      </p>
    );
  }
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-sm">
      <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
      {m.results_no_tolerance()}
      {labId === null ? null : (
        <Link to="/student/tolerances" className="underline underline-offset-4">
          {m.results_set_tolerance()}
        </Link>
      )}
    </p>
  );
}

/**
 * One requested test with every measurement, oldest first, the released one marked (S14, S15,
 * D11). With `actions`, a member of the lab enters a measurement by hand and releases one; a
 * `notice` is a refusal the page shows at the test, after a dialog closed on it.
 */
export function RequestedTest({
  test,
  headingId,
  actions,
  notice = null,
}: Readonly<{
  test: RequestedTestRow;
  headingId: string;
  actions: RequestedTestActions | null;
  notice?: string | null;
}>) {
  const measure = actions?.writable && test.source === "manual" ? actions.onMeasure : null;
  const release =
    actions?.writable && test.tolerance !== null && test.release === null
      ? actions.onRelease
      : null;
  const tableLabel = m.results_measurements_of({ test: test.name });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4
            id={headingId}
            tabIndex={-1}
            className={cn(FOCUSABLE_HEADING, "text-base font-medium")}
          >
            {test.unit ? m.results_test_with_unit({ test: test.name, unit: test.unit }) : test.name}
          </h4>
          <TestStateBadge state={test.state} />
        </div>
        {measure ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={m.results_measure_for({ test: test.name })}
            onClick={measure}
          >
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            {m.results_measure()}
          </Button>
        ) : null}
      </div>
      <ReleaseFacts test={test} labId={actions?.labId ?? null} />
      {notice ? (
        <p role="alert" className="inline-flex items-center gap-1.5 text-destructive text-sm">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {notice}
        </p>
      ) : null}
      {test.measurements.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {test.source === "manual"
            ? m.results_no_measurement()
            : m.results_waiting_for({ source: measurementSourceLabel(test.source) })}
        </p>
      ) : (
        <ScrollRegion label={tableLabel}>
          <Table>
            <TableCaption className="sr-only">{tableLabel}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{m.results_col_recorded()}</TableHead>
                <TableHead scope="col">{m.results_col_sample()}</TableHead>
                <TableHead scope="col">{m.results_col_value()}</TableHead>
                <TableHead scope="col">{m.results_col_source()}</TableHead>
                <TableHead scope="col">{m.results_col_status()}</TableHead>
                {release ? <TableHead scope="col">{m.results_col_action()}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {test.measurements.map((measurement) => (
                <TableRow key={measurement.id}>
                  <TableHead scope="row" className="font-normal">
                    <time dateTime={measurement.recordedAt}>
                      {formatDateTime(measurement.recordedAt)}
                    </time>
                  </TableHead>
                  <TableCell className="whitespace-normal break-words">
                    {m.results_sample_option({
                      sample: measurement.sampleNumber,
                      labNumber: formatLabNumber(measurement.labNumber),
                    })}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDecimal(measurement.value)}</TableCell>
                  <TableCell>{measurementSourceLabel(measurement.source)}</TableCell>
                  <TableCell>{measurement.released ? <ReleasedMark /> : null}</TableCell>
                  {release ? (
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        aria-label={m.results_release_for({
                          value: formatDecimal(measurement.value),
                          time: formatDateTime(measurement.recordedAt),
                        })}
                        onClick={(event) => release(event, measurement)}
                      >
                        <SendIcon aria-hidden="true" data-icon="inline-start" />
                        {m.results_release()}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      )}
    </div>
  );
}
