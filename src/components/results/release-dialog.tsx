// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheckIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
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
import { resultsErrorMessage, toleranceWarning } from "@/lib/i18n/results-labels";
import { formatLabNumber } from "@/lib/lab-number";
import { checkMeasuredValue } from "@/lib/tolerance";
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
 * The confirmation of a release (S15, WCAG 3.3.4): the value, its sample and the team's own
 * tolerance, with a warning (icon and text) when the value lies outside it. The team decides;
 * the warning never blocks. A refusal shows in the dialog, and the dialog stays open.
 */
export function ReleaseDialog({
  control,
  labId,
  target,
  onReleased,
}: Readonly<{
  control: DialogControl;
  labId: string;
  target: ReleaseTarget | undefined;
  /** Runs once the release is stored, before the dialog closes. */
  onReleased: (target: ReleaseTarget) => void;
}>) {
  const queryClient = useQueryClient();
  const call = useServerFn(releaseResultFn);
  const [refusal, setRefusal] = useState<string | null>(null);
  const release = useSimulationAction(
    resultsMutationOptions(queryClient, call, resultsInvalidation.release(labId)),
    {
      success: () => m.results_released({ test: target?.test.name ?? "" }),
      toastErrors: false,
      onDone: () => {
        if (target) onReleased(target);
        control.onOpenChange(false);
      },
    },
  );
  if (!target) return null;
  const { request, test, measurement, tolerance } = target;
  const unit = test.unit ?? "";
  const limits = {
    lower: formatDecimal(tolerance.lower),
    upper: formatDecimal(tolerance.upper),
    unit,
  };
  const check = checkMeasuredValue(measurement.value, tolerance);
  const warning = check === null ? null : toleranceWarning(check, limits);
  return (
    <AlertDialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) setRefusal(null);
        control.onOpenChange(open);
      }}
    >
      <AlertDialogContent onCloseAutoFocus={control.onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.results_release_title({ test: test.name })}</AlertDialogTitle>
          <AlertDialogDescription>{m.results_release_final()}</AlertDialogDescription>
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
        {warning ? (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>{m.results_warning_title()}</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CircleCheckIcon aria-hidden="true" />
            <AlertDescription>{m.results_inside(limits)}</AlertDescription>
          </Alert>
        )}
        {refusal ? (
          <p role="alert" className="text-destructive text-sm">
            {refusal}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{m.simulations_cancel()}</AlertDialogCancel>
          <Button
            type="button"
            disabled={release.isPending}
            onClick={() => {
              setRefusal(null);
              release.mutate(
                {
                  labId,
                  requestId: request.id,
                  testId: test.testId,
                  measurementId: measurement.id,
                  toleranceId: tolerance.id,
                },
                { onError: (error) => setRefusal(resultsErrorMessage(resultsErrorCode(error))) },
              );
            }}
          >
            {release.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SendIcon aria-hidden="true" data-icon="inline-start" />
            )}
            {warning ? m.results_release_anyway() : m.results_release_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
