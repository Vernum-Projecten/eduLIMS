// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConicalIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { idpErrorMessage } from "@/components/admin-idp/idp-labels";
import { ProviderStatusBadge } from "@/components/admin-idp/providers-table";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import {
  deleteIdentityProvider,
  setIdentityProviderEnabled,
  startIdentityProviderTest,
} from "@/server/idp/functions";
import type { ProviderDetail } from "@/server/idp/queries";
import {
  deleteProviderMutationOptions,
  idpErrorCode,
  removeDeletedProvider,
  setProviderEnabledMutationOptions,
} from "@/server/idp/query-options";

/** Returns the path of a provider's test-result page for one test. */
export function testResultPath(providerId: string, test: string): string {
  return `/admin/system/identity-providers/${providerId}/test-result?test=${encodeURIComponent(test)}`;
}

/** The status, test, enable or disable, and delete actions of one provider. */
export function ProviderActions({ provider }: Readonly<{ provider: ProviderDetail }>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const startTest = useServerFn(startIdentityProviderTest);
  const name = provider.label;
  const { providerId } = provider;

  const toggle = useMutation({
    ...setProviderEnabledMutationOptions(queryClient, useServerFn(setIdentityProviderEnabled)),
    onSuccess: (_id, data) =>
      toast.success(data.enabled ? m.idp_enabled_done({ name }) : m.idp_disabled_done({ name })),
    onError: (error) => toast.error(idpErrorMessage(idpErrorCode(error))),
  });

  const deletion = useMutation({
    ...deleteProviderMutationOptions(queryClient, useServerFn(deleteIdentityProvider)),
    onSuccess: async () => {
      toast.success(m.idp_deleted_done({ name }));
      await navigate({ to: "/admin/system/identity-providers" });
      removeDeletedProvider(queryClient, providerId);
    },
    onError: (error) => toast.error(idpErrorMessage(idpErrorCode(error))),
  });

  async function test() {
    // Opened in the click, so the browser does not block it; the address follows.
    const tab = window.open("", "_blank");
    try {
      const { test: id } = await startTest({ data: { providerId } });
      const url = `${testResultPath(providerId, id)}&start=1`;
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch {
      tab?.close();
      toast.error(m.idp_refused_failed());
    }
  }

  return (
    <section aria-labelledby="idp-status" className="flex max-w-2xl flex-col gap-4">
      <h2 id="idp-status" className="text-lg font-semibold">
        {m.idp_section_status()}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <ProviderStatusBadge enabled={provider.enabled} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ providerId, enabled: !provider.enabled })}
        >
          {provider.enabled ? (
            <PowerOffIcon aria-hidden="true" data-icon="inline-start" />
          ) : (
            <PowerIcon aria-hidden="true" data-icon="inline-start" />
          )}
          {provider.enabled ? m.idp_disable() : m.idp_enable()}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void test()}>
          <FlaskConicalIcon aria-hidden="true" data-icon="inline-start" />
          {m.idp_test()}
        </Button>
        <ConfirmButton
          icon={Trash2Icon}
          label={m.idp_delete()}
          title={m.idp_delete_title({ name })}
          description={m.idp_delete_body()}
          confirm={m.idp_delete_confirm()}
          destructive
          pending={deletion.isPending}
          onConfirm={() => deletion.mutate({ providerId })}
        />
      </div>
      <p className="text-sm text-muted-foreground">{m.idp_test_help()}</p>
    </section>
  );
}
