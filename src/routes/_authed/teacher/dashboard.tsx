// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { portalPageTitle, SectionPlaceholder } from "@/components/portal/portal-pages";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/teacher/dashboard")({
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "dashboard")) },
    ],
  }),
  component: Page,
});

function Page() {
  // TODO(#271): the live view per lab of the running simulation replaces this placeholder.
  return (
    <SectionPlaceholder
      section={sectionOf("teacher", "dashboard")}
      body={m.teacher_dashboard_coming()}
    />
  );
}
