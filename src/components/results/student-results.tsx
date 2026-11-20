// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { ClipboardListIcon, LockIcon } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import type { DialogControl } from "@/components/simulations/name-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import type {
  LabResults,
  MeasurementRow,
  RequestedTestRow,
  ResultsRequestRow,
} from "@/server/results/queries";
import { myResultsQueryOptions } from "@/server/results/query-options";
import { MeasurementDialog } from "./measurement-dialog";
import { ReleaseDialog, type ReleaseTarget } from "./release-dialog";
import { RequestResults } from "./request-results";

/** The id of a requested test's heading, which takes the focus once its result is released. */
function testHeadingId(requestId: string, testId: string): string {
  return `result-${requestId}-${testId}`;
}

/**
 * The state of the two dialogs with their focus return (WCAG 2.4.3): the button that opened one
 * takes the focus back when it closes, and after a release, whose button goes, the heading of the
 * requested test takes it.
 */
function useResultsDialogs() {
  const opener = useRef<HTMLButtonElement | null>(null);
  const fallback = useRef<string | null>(null);
  const [measureFor, setMeasureFor] = useState<{
    open: boolean;
    request: ResultsRequestRow;
    test: RequestedTestRow;
  } | null>(null);
  const [releaseFor, setReleaseFor] = useState<{ open: boolean; target: ReleaseTarget } | null>(
    null,
  );
  const returnFocus = (event: Event) => {
    event.preventDefault();
    const button = opener.current;
    if (button?.isConnected && !button.disabled && fallback.current === null) {
      button.focus();
      return;
    }
    const heading = fallback.current === null ? null : document.getElementById(fallback.current);
    heading?.focus();
  };
  const measureControl: DialogControl = {
    open: measureFor?.open ?? false,
    onOpenChange: (open) => {
      if (!open) setMeasureFor((current) => (current ? { ...current, open: false } : null));
    },
    onCloseAutoFocus: returnFocus,
  };
  const releaseControl: DialogControl = {
    open: releaseFor?.open ?? false,
    onOpenChange: (open) => {
      if (!open) setReleaseFor((current) => (current ? { ...current, open: false } : null));
    },
    onCloseAutoFocus: returnFocus,
  };
  return {
    measureFor,
    releaseFor,
    measureControl,
    releaseControl,
    openMeasure(
      event: MouseEvent<HTMLButtonElement>,
      request: ResultsRequestRow,
      test: RequestedTestRow,
    ) {
      opener.current = event.currentTarget;
      fallback.current = null;
      setMeasureFor({ open: true, request, test });
    },
    openRelease(event: MouseEvent<HTMLButtonElement>, target: ReleaseTarget) {
      opener.current = event.currentTarget;
      fallback.current = null;
      setReleaseFor({ open: true, target });
    },
    /** After a release, the focus goes to the heading of the requested test. */
    released(target: ReleaseTarget) {
      fallback.current = testHeadingId(target.request.id, target.test.testId);
    },
  };
}

function ResultsList({ results }: Readonly<{ results: LabResults }>) {
  const dialogs = useResultsDialogs();
  if (results.requests.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardListIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{m.results_empty_title()}</EmptyTitle>
          <EmptyDescription>{m.results_empty_body()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <>
      <ol className="flex flex-col gap-4">
        {results.requests.map((request) => (
          <RequestResults
            key={request.id}
            request={request}
            headingId={(testId) => testHeadingId(request.id, testId)}
            actions={(test) => ({
              writable: results.running && test.release === null,
              onMeasure: (event) => dialogs.openMeasure(event, request, test),
              onRelease: (event: MouseEvent<HTMLButtonElement>, measurement: MeasurementRow) => {
                if (test.tolerance === null) return;
                dialogs.openRelease(event, {
                  request,
                  test,
                  measurement,
                  tolerance: test.tolerance,
                });
              },
            })}
          />
        ))}
      </ol>
      {dialogs.measureFor ? (
        <MeasurementDialog
          key={`${dialogs.measureFor.request.id}-${dialogs.measureFor.test.testId}`}
          control={dialogs.measureControl}
          labId={results.labId}
          request={dialogs.measureFor.request}
          test={dialogs.measureFor.test}
        />
      ) : null}
      <ReleaseDialog
        key={dialogs.releaseFor?.target.measurement.id ?? "none"}
        control={dialogs.releaseControl}
        labId={results.labId}
        target={dialogs.releaseFor?.target}
        onReleased={dialogs.released}
      />
    </>
  );
}

/**
 * The measurements and results of one of the student's own labs (S14, S15): per request every
 * requested test with each measurement, the team's own tolerance, entry by hand and the release.
 * Nothing here comes from a teacher: no correct value, no accuracy limit and no accuracy status
 * (Q-SIM-1, W7).
 */
export function StudentResults({ labId }: Readonly<{ labId: string }>) {
  const { data: results, isFetching } = useSuspenseQuery(myResultsQueryOptions(labId));
  return (
    <div className="relative flex flex-col gap-6" aria-busy={isFetching}>
      <UpdatingIndicator active={isFetching} />
      {results.running ? null : (
        <Alert>
          <LockIcon aria-hidden="true" />
          <AlertTitle>{m.results_not_running_title()}</AlertTitle>
          <AlertDescription>{m.results_not_running_body()}</AlertDescription>
        </Alert>
      )}
      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="font-semibold text-lg">
          {m.results_requests_heading()}
        </h2>
        <ResultsList results={results} />
      </section>
    </div>
  );
}
