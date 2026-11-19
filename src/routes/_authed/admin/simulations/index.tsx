// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// TODO(#291): the administrator's read-only list of simulations replaces this placeholder.
import { createFileRoute } from "@tanstack/react-router";
import { portalPageTitle, SectionPlaceholder } from "@/components/portal/portal-pages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/admin/simulations/")({
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "simulations")) },
    ],
  }),
  component: Page,
});

function Page() {
  return <SectionPlaceholder section={sectionOf("admin", "simulations")} />;
}
