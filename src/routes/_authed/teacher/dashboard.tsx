// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { dashboardQueryOptions } from "@/server/dashboard/query-options";
import { dashboardSearch } from "@/server/dashboard/schemas";

export const Route = createFileRoute("/_authed/teacher/dashboard")({
  validateSearch: dashboardSearch,
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "dashboard")) },
    ],
  }),
  pendingComponent: DashboardPending,
  errorComponent: RouteErrorState,
  component: DashboardPage,
});

function DashboardPending() {
  return (
    <PageFrame title={m.nav_dashboard()} description={m.dashboard_description()}>
      <Skeleton className="h-64 w-full" />
    </PageFrame>
  );
}

function DashboardPage() {
  const { sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isFetching } = useSuspenseQuery(dashboardQueryOptions());
  return (
    <DashboardView
      read={data}
      busy={isFetching}
      sort={sort}
      onSort={(next) =>
        navigate({ search: { sort: next === "board" ? undefined : next }, replace: true })
      }
    />
  );
}
