// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardEmpty } from "@/components/dashboard/dashboard-empty";
import { portalPageTitle, SectionPlaceholder } from "@/components/portal/portal-pages";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { runningSimulationQueryOptions } from "@/server/dashboard/query-options";

export const Route = createFileRoute("/_authed/teacher/dashboard")({
  loader: ({ context }) => context.queryClient.ensureQueryData(runningSimulationQueryOptions()),
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "dashboard")) },
    ],
  }),
  pendingComponent: DashboardPending,
  errorComponent: RouteErrorState,
  component: Page,
});

function DashboardPending() {
  const section = sectionOf("teacher", "dashboard");
  return (
    <PageFrame title={section.label()} description={section.description()}>
      <Skeleton className="h-48 w-full" />
    </PageFrame>
  );
}

// TODO(#271): the board of the running simulation replaces the placeholder.
function Page() {
  const section = sectionOf("teacher", "dashboard");
  const { data } = useSuspenseQuery(runningSimulationQueryOptions());
  if (data.kind === "running") {
    return <SectionPlaceholder section={section} body={m.teacher_dashboard_coming()} />;
  }
  return (
    <PageFrame title={section.label()} description={section.description()}>
      <DashboardEmpty kind={data.kind} />
    </PageFrame>
  );
}
