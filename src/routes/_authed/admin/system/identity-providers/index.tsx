// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { ProvidersTable } from "@/components/admin-idp/providers-table";
import { Page } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { portalNavigation } from "@/lib/navigation";
import { identityProvidersQueryOptions } from "@/server/idp/query-options";

export const Route = createFileRoute("/_authed/admin/system/identity-providers/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(identityProvidersQueryOptions()),
  head: () => ({
    meta: [{ title: `${m.idp_title()} | ${portalNavigation("admin").label()} | eduLIMS` }],
  }),
  component: IdentityProvidersPage,
});

function IdentityProvidersPage() {
  const { data } = useSuspenseQuery(identityProvidersQueryOptions());
  return (
    <Page
      title={m.idp_title()}
      description={<p>{m.idp_description()}</p>}
      actions={
        <>
          <Button asChild>
            <Link to="/admin/system/identity-providers/new" search={{ protocol: "oidc" }}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              {m.idp_add_oidc()}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/admin/system/identity-providers/new" search={{ protocol: "saml" }}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              {m.idp_add_saml()}
            </Link>
          </Button>
        </>
      }
    >
      <ProvidersTable
        rows={data}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>{m.idp_empty()}</h2>
              </EmptyTitle>
              <EmptyDescription>{m.idp_empty_body()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </Page>
  );
}
