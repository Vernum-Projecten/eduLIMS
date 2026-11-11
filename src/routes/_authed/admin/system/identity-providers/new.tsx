// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";
import { ProviderForm } from "@/components/admin-idp/provider-form";
import { emptyProviderForm } from "@/components/admin-idp/provider-form-schema";
import { Page } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { PROVIDER_PROTOCOLS } from "@/lib/identity-providers";
import { portalNavigation } from "@/lib/navigation";

const newProviderSearch = z.object({
  protocol: z.enum(PROVIDER_PROTOCOLS).catch("oidc"),
});

export const Route = createFileRoute("/_authed/admin/system/identity-providers/new")({
  validateSearch: newProviderSearch,
  head: () => ({
    meta: [
      {
        title: `${m.idp_create()} | ${m.idp_title()} | ${portalNavigation("admin").label()} | eduLIMS`,
      },
    ],
  }),
  component: NewProviderPage,
});

function NewProviderPage() {
  const { protocol } = Route.useSearch();
  return (
    <Page
      title={protocol === "saml" ? m.idp_new_saml_title() : m.idp_new_oidc_title()}
      description={<p>{m.idp_new_description()}</p>}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/system/identity-providers">
            <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
            {m.idp_back()}
          </Link>
        </Button>
      }
    >
      <ProviderForm
        key={protocol}
        mode="create"
        protocol={protocol}
        initial={emptyProviderForm(protocol)}
      />
    </Page>
  );
}
