// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { ClipboardListIcon, LockIcon } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { focusById } from "@/components/simulations/focus";
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
import type { LabResults } from "@/server/results/queries";
import { myResultsQueryOptions } from "@/server/results/query-options";
import { MeasurementDialog } from "./measurement-dialog";
import { ReleaseDialog, type ReleaseTarget } from "./release-dialog";
import { RequestResults } from "./request-results";

/** The id of a requested test's heading, which takes the focus when its button is gone. */
function testHeadingId(requestId: string, testId: string): string {
  return `result-${requestId}-${testId}`;
}

/** Which dialog is open, by ids only; the rows come from the query, so they are never stale. */
interface DialogIds {
  kind: "measure" | "release";
  open: boolean;
  requestId: string;
  testId: string;
  measurementId: string | null;
}

/** A refusal the page shows at a requested test after a dialog closed on it. */
interface Notice {
  requestId: string;
  testId: string;
  message: string;
}

/** Returns the release the dialog ids name in the current data, or `undefined` once it is gone. */
function releaseTarget(results: LabResults, ids: DialogIds): ReleaseTarget | undefined {
  const request = results.requests.find((row) => row.id === ids.requestId);
  const test = request?.tests.find((row) => row.testId === ids.testId);
  const measurement = test?.measurements.find((row) => row.id === ids.measurementId);
  if (!request || !test || !measurement || !test.tolerance || test.release) return undefined;
  return { request, test, measurement, tolerance: test.tolerance };
}

/**
 * The dialogs of the results page with their focus return (WCAG 2.4.3): the button that opened
 * one takes the focus back when it closes and is still there; otherwise, after a release or a
 * refusal that closed the dialog, the heading of the requested test takes it.
 */
function useResultsDialogs() {
  const opener = useRef<HTMLButtonElement | null>(null);
  const [ids, setIds] = useState<DialogIds | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const toHeading = useRef(false);
  const control: DialogControl = {
    open: ids?.open ?? false,
    onOpenChange: (open) => {
      if (!open) setIds((current) => (current ? { ...current, open: false } : null));
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      const button = opener.current;
      if (!toHeading.current && button?.isConnected && !button.disabled) {
        button.focus();
      } else if (ids) {
        focusById(testHeadingId(ids.requestId, ids.testId));
      }
    },
  };
  function openFrom(event: MouseEvent<HTMLButtonElement>, next: Omit<DialogIds, "open">) {
    opener.current = event.currentTarget;
    toHeading.current = false;
    setNotice(null);
    setIds({ ...next, open: true });
  }
  return {
    ids,
    control,
    notice,
    openMeasure(event: MouseEvent<HTMLButtonElement>, requestId: string, testId: string) {
      openFrom(event, { kind: "measure", requestId, testId, measurementId: null });
    },
    openRelease(
      event: MouseEvent<HTMLButtonElement>,
      requestId: string,
      testId: string,
      measurementId: string,
    ) {
      openFrom(event, { kind: "release", requestId, testId, measurementId });
    },
    /** Closes the dialog after a release; its button goes, so the focus goes to the heading. */
    released() {
      toHeading.current = true;
      control.onOpenChange(false);
    },
    /** Closes the dialog on a refusal and shows it at the requested test. */
    closedOn(message: string) {
      toHeading.current = true;
      if (ids) setNotice({ requestId: ids.requestId, testId: ids.testId, message });
      control.onOpenChange(false);
    },
  };
}

function ResultsList({ results }: Readonly<{ results: LabResults }>) {
  const dialogs = useResultsDialogs();
  const { ids } = dialogs;
  // The released row leaves the open set once the data refetches, while the dialog still closes.
  const shown = useRef<ReleaseTarget | undefined>(undefined);
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
  const measureRequest =
    ids?.kind === "measure" ? results.requests.find((row) => row.id === ids.requestId) : undefined;
  const measureTest = measureRequest?.tests.find((row) => row.testId === ids?.testId);
  const live = ids?.kind === "release" ? releaseTarget(results, ids) : undefined;
  if (live) shown.current = live;
  const target = live ?? (ids?.kind === "release" && !ids.open ? shown.current : undefined);
  return (
    <>
      <ol className="flex flex-col gap-4">
        {results.requests.map((request) => (
          <RequestResults
            key={request.id}
            request={request}
            headingId={(testId) => testHeadingId(request.id, testId)}
            notice={(testId) =>
              dialogs.notice?.requestId === request.id && dialogs.notice.testId === testId
                ? dialogs.notice.message
                : null
            }
            actions={(test) => ({
              labId: results.labId,
              writable: results.running && test.release === null,
              onMeasure: (event) => dialogs.openMeasure(event, request.id, test.testId),
              onRelease: (event, measurement) =>
                dialogs.openRelease(event, request.id, test.testId, measurement.id),
            })}
          />
        ))}
      </ol>
      {measureRequest && measureTest ? (
        <MeasurementDialog
          key={`${measureRequest.id}-${measureTest.testId}`}
          control={dialogs.control}
          labId={results.labId}
          request={measureRequest}
          test={measureTest}
          onClosingRefusal={dialogs.closedOn}
        />
      ) : null}
      {target ? (
        <ReleaseDialog
          key={target.measurement.id}
          control={dialogs.control}
          labId={results.labId}
          target={target}
          onReleased={dialogs.released}
          onClosingRefusal={dialogs.closedOn}
        />
      ) : null}
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
