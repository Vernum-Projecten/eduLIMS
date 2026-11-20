// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlertIcon, CircleCheckIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import type { DialogControl } from "@/components/simulations/name-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { m } from "@/i18n/messages";
import { formatDecimal } from "@/lib/i18n/format";
import { releaseVerdict, resultsErrorMessage } from "@/lib/i18n/results-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { ResultsActionError } from "@/server/results/access";
import { releaseResultFn } from "@/server/results/functions";
import type {
  MeasurementRow,
  RequestedTestRow,
  ResultsRequestRow,
  ToleranceRef,
} from "@/server/results/queries";
import {
  resultsErrorCode,
  resultsInvalidation,
  resultsMutationOptions,
} from "@/server/results/query-options";

/** What the confirmation releases: one measurement of a requested test, with its tolerance. */
export interface ReleaseTarget {
  request: ResultsRequestRow;
  test: RequestedTestRow;
  measurement: MeasurementRow;
  tolerance: ToleranceRef;
}

/**
 * The refusals after which the dialog has nothing left to confirm: the tolerance it showed is
 * no longer in force, the test is released, or the simulation stopped. The dialog closes and the
 * page shows the refusal at the requested test.
 */
export const CLOSING_REFUSALS: readonly ResultsActionError[] = [
  "tolerance_changed",
  "released",
  "not_running",
];

/**
 * The confirmation of a release (S15, WCAG 3.3.4): the value, its sample and the team's own
 * tolerance, with a warning (icon and text) when the value lies outside it. The team decides;
 * the warning never blocks. A refusal that leaves something to confirm shows in the dialog; one
 * of {@link CLOSING_REFUSALS} closes it through `onClosingRefusal`.
 */
export function ReleaseDialog({
  control,
  labId,
  target,
  onReleased,
  onClosingRefusal,
}: Readonly<{
  control: DialogControl;
  labId: string;
  target: ReleaseTarget;
  /** Runs once the release is stored, before the dialog closes. */
  onReleased: () => void;
  /** Runs on a refusal of {@link CLOSING_REFUSALS}, with its message; the caller closes. */
  onClosingRefusal: (message: string) => void;
}>) {
  const queryClient = useQueryClient();
  const call = useServerFn(releaseResultFn);
  const [refusal, setRefusal] = useState<string | null>(null);
  const descriptionId = useId();
  const warningId = useId();
  const { request, test, measurement, tolerance } = target;
  const release = useSimulationAction(
    resultsMutationOptions(queryClient, call, resultsInvalidation.release(labId)),
    {
      success: () => m.results_released({ test: test.name }),
      toastErrors: false,
      onDone: onReleased,
    },
  );
  const unit = test.unit ?? "";
  const limits = {
    lower: formatDecimal(tolerance.lower),
    upper: formatDecimal(tolerance.upper),
    unit,
  };
  const verdict = releaseVerdict(measurement.value, tolerance, test.unit);
  const describedBy = verdict.kind === "inside" ? descriptionId : `${descriptionId} ${warningId}`;
  return (
    <AlertDialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) setRefusal(null);
        control.onOpenChange(open);
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={describedBy}
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{m.results_release_title({ test: test.name })}</AlertDialogTitle>
          <AlertDialogDescription id={descriptionId}>
            {m.results_release_final()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{m.results_col_value()}</dt>
          <dd className="font-medium tabular-nums">
            {formatDecimal(measurement.value)} {unit}
          </dd>
          <dt className="text-muted-foreground">{m.results_col_sample()}</dt>
          <dd className="break-words">
            {m.results_sample_option({
              sample: measurement.sampleNumber,
              labNumber: formatLabNumber(measurement.labNumber),
            })}
          </dd>
          <dt className="text-muted-foreground">{m.results_your_tolerance()}</dt>
          <dd className="tabular-nums">{m.results_tolerance_range(limits)}</dd>
          {request.patientName ? (
            <>
              <dt className="text-muted-foreground">{m.results_patient()}</dt>
              <dd className="break-words">{request.patientName}</dd>
            </>
          ) : null}
        </dl>
        {verdict.kind === "unreadable" ? (
          <Alert id={warningId} variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{verdict.text}</AlertDescription>
          </Alert>
        ) : verdict.kind === "outside" ? (
          <Alert id={warningId} variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>{m.results_warning_title()}</AlertTitle>
            <AlertDescription>{verdict.text}</AlertDescription>
          </Alert>
        ) : (
          <Alert role="note">
            <CircleCheckIcon aria-hidden="true" />
            <AlertDescription>{verdict.text}</AlertDescription>
          </Alert>
        )}
        {refusal ? (
          <p role="alert" className="text-destructive text-sm">
            {refusal}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{m.simulations_cancel()}</AlertDialogCancel>
          {verdict.kind === "unreadable" ? null : (
            <Button
              type="button"
              aria-disabled={release.isPending || undefined}
              onClick={() => {
                if (release.isPending) return;
                setRefusal(null);
                release.mutate(
                  {
                    labId,
                    requestId: request.id,
                    testId: test.testId,
                    measurementId: measurement.id,
                    toleranceId: tolerance.id,
                  },
                  {
                    onError: (error) => {
                      const code = resultsErrorCode(error);
                      const message = resultsErrorMessage(code);
                      if (code !== null && CLOSING_REFUSALS.includes(code)) {
                        onClosingRefusal(message);
                      } else {
                        setRefusal(message);
                      }
                    },
                  },
                );
              }}
            >
              {release.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon aria-hidden="true" data-icon="inline-start" />
              )}
              {verdict.kind === "outside"
                ? m.results_release_anyway()
                : m.results_release_confirm()}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
