// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { protocolLabel } from "@/components/admin-idp/idp-labels";
import { ProviderActions } from "@/components/admin-idp/provider-actions";
import { ProviderForm } from "@/components/admin-idp/provider-form";
import type { ProviderFormValues } from "@/components/admin-idp/provider-form-schema";
import { ProviderUrls } from "@/components/admin-idp/provider-urls";
import { Page } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { portalNavigation } from "@/lib/navigation";
import type { ProviderDetail } from "@/server/idp/queries";
import { identityProviderQueryOptions } from "@/server/idp/query-options";

export const Route = createFileRoute("/_authed/admin/system/identity-providers/$providerId/")({
  loader: async ({ context, params }) => {
    const provider = await context.queryClient.ensureQueryData(
      identityProviderQueryOptions(params.providerId),
    );
    return { label: provider.label };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.label ?? m.idp_title()} | ${m.idp_title()} | ${portalNavigation("admin").label()} | eduLIMS`,
      },
    ],
  }),
  notFoundComponent: ProviderNotFound,
  component: ProviderPage,
});

/** Returns the edit form's values: the stored settings, secrets empty (write-only). */
function formValues(provider: ProviderDetail): ProviderFormValues {
  return {
    providerId: provider.providerId,
    protocol: provider.protocol,
    settings: provider.settings,
    oidc: {
      issuer: provider.oidc?.issuer ?? "",
      clientId: provider.oidc?.clientId ?? "",
      clientSecret: "",
    },
    saml: { metadataXml: "", metadataUrl: provider.saml?.metadataUrl ?? "", spPrivateKey: "" },
  };
}

function BackLink() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/admin/system/identity-providers">
        <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
        {m.idp_back()}
      </Link>
    </Button>
  );
}

function ProviderPage() {
  const { providerId } = Route.useParams();
  const { data: provider } = useSuspenseQuery(identityProviderQueryOptions(providerId));
  return (
    <Page
      title={provider.label}
      description={
        <p>
          {protocolLabel(provider.protocol)} ·{" "}
          <span className="font-mono">{provider.providerId}</span>
        </p>
      }
      actions={<BackLink />}
    >
      <ProviderActions provider={provider} />
      <ProviderUrls provider={provider} />
      <section aria-labelledby="idp-settings" className="flex flex-col gap-4">
        <h2 id="idp-settings" className="text-lg font-semibold">
          {m.idp_section_settings()}
        </h2>
        <ProviderForm
          key={provider.providerId}
          mode="edit"
          protocol={provider.protocol}
          initial={formValues(provider)}
          stored={{
            clientSecret: provider.oidc?.secretSet ?? false,
            spPrivateKey: provider.saml?.signingKeySet ?? false,
            metadata: provider.saml !== null,
          }}
        />
      </section>
    </Page>
  );
}

function ProviderNotFound() {
  return (
    <Page title={m.idp_title()} actions={<BackLink />}>
      <p role="alert">{m.idp_refused_not_found()}</p>
    </Page>
  );
}
