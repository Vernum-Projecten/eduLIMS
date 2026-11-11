// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { idpErrorField, idpErrorMessage } from "@/components/admin-idp/idp-labels";
import {
  type ProviderFormValues,
  toCreateInput,
  toUpdateInput,
} from "@/components/admin-idp/provider-form-schema";
import { m } from "@/i18n/messages";
import { createIdentityProvider, updateIdentityProvider } from "@/server/idp/functions";
import {
  createProviderMutationOptions,
  idpErrorCode,
  updateProviderMutationOptions,
} from "@/server/idp/query-options";

/** A refused save: the message, and the form field it belongs to (`null`: the whole form). */
export interface SaveRefusal {
  field: string | null;
  message: string;
}

/**
 * Returns the save action of the provider form (#46): it creates or updates the provider, shows
 * the toast, opens a new provider's page, and returns the refusal of a refused save.
 */
export function useSaveProvider(mode: "create" | "edit") {
  const queryClient = useQueryClient();
  const create = useMutation(
    createProviderMutationOptions(queryClient, useServerFn(createIdentityProvider)),
  );
  const update = useMutation(
    updateProviderMutationOptions(queryClient, useServerFn(updateIdentityProvider)),
  );
  const navigate = useNavigate();
  return async (value: ProviderFormValues): Promise<SaveRefusal | null> => {
    let providerId: string;
    try {
      providerId =
        mode === "create"
          ? await create.mutateAsync(toCreateInput(value))
          : await update.mutateAsync(toUpdateInput(value));
    } catch (error) {
      const code = idpErrorCode(error);
      return {
        field: code === "failed" ? null : idpErrorField(code),
        message: idpErrorMessage(code),
      };
    }
    const name = value.settings.labelEn;
    if (mode === "create") {
      toast.success(m.idp_created_done({ name }));
      await navigate({
        to: "/admin/system/identity-providers/$providerId",
        params: { providerId },
      });
      return null;
    }
    toast.success(m.idp_saved_done({ name }));
    return null;
  };
}
