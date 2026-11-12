// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { StudentClasses } from "@/components/classes/student-classes";
import { PortalOverview, portalPageTitle } from "@/components/portal/portal-pages";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState } from "@/components/shell/route-error";
import { portalNavigation } from "@/lib/navigation";
import { studentClassesQueryOptions } from "@/server/classes/query-options";

export const Route = createFileRoute("/_authed/student/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(studentClassesQueryOptions()),
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
      <StudentClasses />
    </PortalOverview>
  );
}
