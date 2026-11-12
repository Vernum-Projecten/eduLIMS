// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AccountTiles } from "@/components/admin-overview/account-tiles";
import { IntegrationTiles } from "@/components/admin-overview/integration-tiles";
import { RecentActivity } from "@/components/admin-overview/recent-activity";
import { PortalSections, portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation } from "@/lib/navigation";
import { adminOverviewQueryOptions } from "@/server/admin-overview/query-options";
import { integrationStatusQueryOptions } from "@/server/integrations/query-options";

export const Route = createFileRoute("/_authed/admin/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(adminOverviewQueryOptions()),
      context.queryClient.ensureQueryData(integrationStatusQueryOptions()),
    ]);
  },
  head: () => {
    const portal = portalNavigation("admin");
    return { meta: [{ title: portalPageTitle(portal, portal.overview) }] };
  },
  pendingComponent: OverviewPendingPage,
  errorComponent: RouteErrorState,
  component: OverviewPage,
});

function OverviewHeader({ children }: Readonly<{ children: ReactNode }>) {
  const { user } = Route.useRouteContext();
  const portal = portalNavigation("admin");
  return (
    <Page
      title={portal.label()}
      description={
        <>
          <p className="text-foreground">{m.welcome({ name: user.name })}</p>
          <p>{portal.overview.description()}</p>
        </>
      }
    >
      {children}
    </Page>
  );
}

function OverviewPendingPage() {
  return (
    <OverviewHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" aria-hidden="true" />
      <Skeleton className="h-64 w-full" aria-hidden="true" />
    </OverviewHeader>
  );
}

/** The Admin portal's overview (#36): account counts, the integrations and the latest events. */
function OverviewPage() {
  const overview = useSuspenseQuery(adminOverviewQueryOptions());
  const status = useSuspenseQuery(integrationStatusQueryOptions());
  const { counts, activity, readAt } = overview.data;

  return (
    <OverviewHeader>
      <section aria-labelledby="overview-accounts" className="flex flex-col gap-4">
        <h2 id="overview-accounts" className="text-lg font-semibold">
          {m.admin_overview_accounts_heading()}
        </h2>
        <div className="relative" aria-busy={overview.isFetching || undefined}>
          <UpdatingIndicator active={overview.isFetching} />
          <AccountTiles counts={counts} />
        </div>
      </section>
      <section aria-labelledby="overview-integrations" className="flex flex-col gap-4">
        <h2 id="overview-integrations" className="text-lg font-semibold">
          {m.admin_overview_integrations_heading()}
        </h2>
        <IntegrationTiles page={status.data} fetching={status.isFetching} />
      </section>
      <section aria-labelledby="overview-activity" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-activity" className="text-lg font-semibold">
            {m.admin_overview_activity_heading()}
          </h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/activity">
              {m.admin_overview_activity_all()}
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        </div>
        <RecentActivity events={activity} readAt={readAt} />
      </section>
      <PortalSections portal={portalNavigation("admin")} />
    </OverviewHeader>
  );
}
