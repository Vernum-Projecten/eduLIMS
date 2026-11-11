// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { analyserErrorMessage } from "@/lib/i18n/analyser-labels";
import { analyserErrorCode } from "@/server/analysers/query-options";

/**
 * Runs an analyser-register mutation from `src/server/analysers/query-options.ts` and announces
 * its outcome in a toast (a live region): `success` on success, the translated refusal on
 * failure unless `toastErrors` is off (a form shows the refusal at its field instead). The
 * options' own callbacks (the targeted invalidation) run first.
 */
export function useAnalyserMutation<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  success: (data: TData, variables: TVariables) => string,
  toastErrors = true,
) {
  return useMutation({
    ...options,
    onSuccess: async (...args) => {
      await options.onSuccess?.(...args);
      toast.success(success(args[0], args[1]));
    },
    onError: async (...args) => {
      await options.onError?.(...args);
      if (toastErrors) toast.error(analyserErrorMessage(analyserErrorCode(args[0])));
    },
  });
}
