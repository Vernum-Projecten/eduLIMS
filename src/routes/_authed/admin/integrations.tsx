// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { AnalysersTable } from "@/components/admin-analysers/analysers-table";
import { IntegrationStatusPanel } from "@/components/admin-integrations/integration-status";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminAnalysersQueryOptions } from "@/server/analysers/query-options";
import { analyserListSearchSchema } from "@/server/analysers/schemas";
import { analyserListInput } from "@/server/analysers/table-state";
import { integrationStatusQueryOptions } from "@/server/integrations/query-options";

export const Route = createFileRoute("/_authed/admin/integrations")({
  validateSearch: analyserListSearchSchema,
  loaderDeps: ({ search }) => analyserListInput(search),
  loader: async ({ context, deps, cause }) => {
    const status = context.queryClient.ensureQueryData(integrationStatusQueryOptions());
    const page = context.queryClient.ensureQueryData(adminAnalysersQueryOptions(deps));
    // NOTE: #58: on a new sort, filter or page the register stays and shows "Updating…"
    // (keepPreviousData) instead of blocking the navigation; entering the page waits for both.
    if (cause === "stay") return void page.catch(() => undefined);
    await Promise.all([status, page]);
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "integrations")) },
    ],
  }),
  pendingComponent: IntegrationsPendingPage,
  errorComponent: RouteErrorState,
  component: IntegrationsPage,
});

function IntegrationsPendingPage() {
  const section = sectionOf("admin", "integrations");
  return (
    <Page title={section.label()} description={<p>{m.admin_integrations_page_description()}</p>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden="true">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <DataTableSkeleton rows={3} />
    </Page>
  );
}

function IntegrationsPage() {
  const search = Route.useSearch();
  const section = sectionOf("admin", "integrations");
  const statusHeadingId = useId();
  const registerHeadingId = useId();
  const status = useQuery(integrationStatusQueryOptions());
  const analysers = useQuery(adminAnalysersQueryOptions(analyserListInput(search)));

  return (
    <Page title={section.label()} description={<p>{m.admin_integrations_page_description()}</p>}>
      <section aria-labelledby={statusHeadingId}>
        {status.data ? (
          <IntegrationStatusPanel
            page={status.data}
            fetching={status.isFetching}
            headingId={statusHeadingId}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </section>
      <section aria-labelledby={registerHeadingId}>
        {analysers.data ? (
          <AnalysersTable
            page={analysers.data}
            search={search}
            fetching={analysers.isFetching && analysers.isPlaceholderData}
            headingId={registerHeadingId}
          />
        ) : (
          <DataTableSkeleton rows={3} />
        )}
      </section>
    </Page>
  );
}
