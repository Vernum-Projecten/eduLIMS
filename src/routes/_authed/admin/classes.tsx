// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { portalPageTitle, SectionPlaceholder } from "@/components/portal/portal-pages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/admin/classes")({
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "classes")) }],
  }),
  component: Page,
});

function Page() {
  return <SectionPlaceholder section={sectionOf("admin", "classes")} />;
}
