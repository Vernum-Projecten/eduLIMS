// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { recordsErrorMessage } from "@/lib/i18n/records-labels";
import type { RecordsResult } from "@/server/lab-records/access";
import {
  labRecordsInvalidation,
  recordsErrorCode,
  recordsMutationOptions,
} from "@/server/lab-records/query-options";

/** A records server function, as `createServerFn` declares it. */
type RecordsFn<TInput, TValue> = (options: { data: TInput }) => Promise<RecordsResult<TValue>>;

/**
 * Runs one write of a lab's records: it invalidates that lab's records only and announces the
 * success in a toast, a live region (WCAG 4.1.3). A form shows a refusal at its field or at the
 * top, so no refusal toast is shown here.
 */
export function useRecordsAction<TInput, TValue>(
  fn: RecordsFn<TInput, TValue>,
  labId: string,
  success: (value: TValue) => string,
) {
  const queryClient = useQueryClient();
  const call = useServerFn(fn);
  return useSimulationAction(
    recordsMutationOptions(queryClient, call, labRecordsInvalidation.lab(labId)),
    { success: (value) => success(value), toastErrors: false },
  );
}

/** Returns the translated message of a failed write, a refusal or anything else. */
export function recordsRefusal(error: unknown): string {
  return recordsErrorMessage(recordsErrorCode(error));
}
