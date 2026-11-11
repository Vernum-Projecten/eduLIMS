// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { PortalOverview, portalPageTitle } from "@/components/portal/portal-pages";
import { portalNavigation } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/admin/")({
  head: () => {
    const portal = portalNavigation("admin");
    return { meta: [{ title: portalPageTitle(portal, portal.overview) }] };
  },
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return <PortalOverview portal={portalNavigation("admin")} userName={user.name} />;
}
