// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { simulationErrorCode } from "@/server/simulations/query-options";

/** What the screen does with the outcome of an action. */
export interface ActionFeedback<TData, TVariables> {
  /** The toast once it is done; `null` for none. */
  success: ((data: TData, variables: TVariables) => string) | null;
  /** Off when a form shows the refusal at its field instead of a toast. */
  toastErrors?: boolean;
  /**
   * Runs once it is done, before the invalidated lists refetch, while the row it acted on is
   * still on screen: the place to close a confirmation (WCAG 2.4.3).
   */
  onDone?: (() => void) | undefined;
  /** Runs once it failed or was refused. */
  onFailed?: (() => void) | undefined;
}

/**
 * Runs a mutation from `src/server/simulations/query-options.ts` and announces its outcome in a
 * toast, a live region (WCAG 4.1.3): the success message, or the translated refusal. These
 * callbacks belong to the mutation itself, so they run even when the row that started it goes.
 */
export function useSimulationAction<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  { success, toastErrors = true, onDone, onFailed }: ActionFeedback<TData, TVariables>,
) {
  return useMutation({
    ...options,
    onSuccess: async (...args) => {
      onDone?.();
      if (success) toast.success(success(args[0], args[1]));
      await options.onSuccess?.(...args);
    },
    onError: async (...args) => {
      await options.onError?.(...args);
      onFailed?.();
      if (toastErrors) toast.error(simulationErrorMessage(simulationErrorCode(args[0])));
    },
  });
}
