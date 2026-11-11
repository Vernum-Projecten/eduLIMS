// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { portalPageTitle, SectionPlaceholder } from "@/components/portal/portal-pages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/teacher/classes")({
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "classes")) },
    ],
  }),
  component: Page,
});

function Page() {
  return <SectionPlaceholder section={sectionOf("teacher", "classes")} />;
}
