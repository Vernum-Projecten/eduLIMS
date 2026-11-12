// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AdminClassesTable } from "@/components/classes/classes-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminClassesQueryOptions } from "@/server/classes/query-options";

export const Route = createFileRoute("/_authed/admin/classes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminClassesQueryOptions()),
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "classes")) }],
  }),
  pendingComponent: AdminClassesPending,
  errorComponent: RouteErrorState,
  component: AdminClassesPage,
});

function Description() {
  return (
    <>
      <p>{m.classes_admin_description()}</p>
      {/* TODO(#37): ownership transfer and archiving for administrators. */}
      <p>{m.classes_admin_read_only()}</p>
    </>
  );
}

function AdminClassesPending() {
  return (
    <Page title={sectionOf("admin", "classes").label()} description={<Description />}>
      <DataTableSkeleton rows={4} />
    </Page>
  );
}

function AdminClassesPage() {
  const { data } = useSuspenseQuery(adminClassesQueryOptions());
  return (
    <Page title={sectionOf("admin", "classes").label()} description={<Description />}>
      <AdminClassesTable rows={data} />
    </Page>
  );
}
