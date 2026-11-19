// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { catalogueErrorMessage } from "@/lib/i18n/catalogue-labels";
import { toast } from "@/lib/toast";
import { catalogueErrorCode } from "@/server/catalogue/query-options";

/**
 * Runs a catalogue mutation from `src/server/catalogue/query-options.ts` and announces its
 * outcome in a toast (a live region): `success` on success, the translated refusal on failure
 * unless `toastErrors` is off (a form shows the refusal at its field instead). The options' own
 * callbacks (the targeted invalidation) run first.
 */
export function useCatalogueMutation<TData, TVariables, TContext>(
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
      if (toastErrors) toast.error(catalogueErrorMessage(catalogueErrorCode(args[0])));
    },
  });
}
