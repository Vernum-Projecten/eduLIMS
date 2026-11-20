// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { PortalOverview, portalPageTitle } from "@/components/portal/portal-pages";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState } from "@/components/shell/route-error";
import { JoinLabForm } from "@/components/simulations/join-lab-form";
import { StudentLabs } from "@/components/simulations/student-labs";
import { portalNavigation } from "@/lib/navigation";
import { myLabsQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/student/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(myLabsQueryOptions());
  },
  head: () => {
    const portal = portalNavigation("student");
    return { meta: [{ title: portalPageTitle(portal, portal.overview) }] };
  },
  pendingComponent: PageSkeleton,
  errorComponent: RouteErrorState,
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <PortalOverview portal={portalNavigation("student")} userName={user.name}>
      <StudentLabs />
      <JoinLabForm />
    </PortalOverview>
  );
}
