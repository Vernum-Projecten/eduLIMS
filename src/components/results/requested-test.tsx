// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  FlaskConicalIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { ScrollRegion } from "@/components/lab-records/scroll-region";
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
import { measurementSourceLabel, requestedTestStateLabel } from "@/lib/i18n/results-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { RequestedTestState } from "@/lib/results";
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
  /** Whether the team can write: the simulation runs and the test is not released. */
  writable: boolean;
  onMeasure: ((event: MouseEvent<HTMLButtonElement>) => void) | null;
  onRelease: (event: MouseEvent<HTMLButtonElement>, measurement: MeasurementRow) => void;
}

/** The team's own tolerance of the test, or what it lacks for a release (S13). */
function ToleranceLine({ test, student }: Readonly<{ test: RequestedTestRow; student: boolean }>) {
  const unit = test.unit ?? "";
  if (test.release) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{m.results_release_tolerance()} </span>
        <span className="tabular-nums">
          {m.results_tolerance_range({
            lower: formatDecimal(test.release.tolerance.lower),
            upper: formatDecimal(test.release.tolerance.upper),
            unit,
          })}
        </span>
      </p>
    );
  }
  if (test.tolerance) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{m.results_your_tolerance()} </span>
        <span className="tabular-nums">
          {m.results_tolerance_range({
            lower: formatDecimal(test.tolerance.lower),
            upper: formatDecimal(test.tolerance.upper),
            unit,
          })}
        </span>
      </p>
    );
  }
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-sm">
      <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
      {m.results_no_tolerance()}
      {student ? (
        <Link to="/student/tolerances" className="underline underline-offset-4">
          {m.results_set_tolerance()}
        </Link>
      ) : null}
    </p>
  );
}

/**
 * One requested test with every measurement, oldest first, the released one marked (S14, S15,
 * D11). With `actions`, a member of the lab enters a measurement by hand and releases one.
 */
export function RequestedTest({
  test,
  headingId,
  actions,
}: Readonly<{ test: RequestedTestRow; headingId: string; actions: RequestedTestActions | null }>) {
  const measure = actions?.writable && test.source === "manual" ? actions.onMeasure : null;
  const release =
    actions?.writable && test.tolerance !== null && test.release === null
      ? actions.onRelease
      : null;
  const tableLabel = m.results_measurements_of({ test: test.name });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 id={headingId} tabIndex={-1} className="font-medium outline-none">
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
      <ToleranceLine test={test} student={actions !== null} />
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
                  <TableCell>
                    {measurement.released ? (
                      <ReleasedMark />
                    ) : release ? (
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
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      )}
    </section>
  );
}
