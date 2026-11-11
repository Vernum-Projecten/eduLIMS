// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { classErrorCode } from "@/server/classes/query-options";

/**
 * Runs a class mutation from `src/server/classes/query-options.ts` and announces its outcome in
 * a toast (a live region): `success` on success, the translated refusal on failure unless a form
 * shows it (`inForm`). The options' own invalidation runs first.
 */
export function useClassMutation<TData, TVariables>(
  options: UseMutationOptions<TData, Error, TVariables>,
  success: (data: TData, variables: TVariables) => string | null,
  { inForm = false }: { inForm?: boolean } = {},
) {
  return useMutation({
    ...options,
    onSuccess: async (...args) => {
      await options.onSuccess?.(...args);
      const message = success(args[0], args[1]);
      if (message) toast.success(message);
    },
    onError: async (...args) => {
      await options.onError?.(...args);
      if (!inForm) toast.error(classErrorMessage(classErrorCode(args[0])));
    },
  });
}
