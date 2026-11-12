// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AdminCreateClassDialog } from "@/components/admin-classes/admin-class-dialogs";
import { AdminClassesTable } from "@/components/admin-classes/admin-classes-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import {
  adminClassesQueryOptions,
  teacherCandidatesQueryOptions,
} from "@/server/classes/admin-query-options";
import { adminClassListSearchSchema } from "@/server/classes/admin-schemas";
import { adminClassesInputFromSearch } from "@/server/classes/admin-table-state";

export const Route = createFileRoute("/_authed/admin/classes/")({
  validateSearch: adminClassListSearchSchema,
  loaderDeps: ({ search }) => adminClassesInputFromSearch(search),
  loader: async ({ context, deps, cause }) => {
    const page = context.queryClient.ensureQueryData(adminClassesQueryOptions(deps));
    // The owner choices of "New class" (#37).
    const teachers = context.queryClient.ensureQueryData(teacherCandidatesQueryOptions());
    // NOTE: #58; a new filter or page keeps the table on screen with "Updating…".
    if (cause === "stay") return void page.catch(() => undefined);
    await Promise.all([page, teachers]);
  },
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "classes")) }],
  }),
  pendingComponent: AdminClassesPending,
  errorComponent: RouteErrorState,
  component: AdminClassesPage,
});

function AdminClassesPending() {
  return (
    <Page
      title={sectionOf("admin", "classes").label()}
      description={<p>{m.classes_admin_description()}</p>}
    >
      <DataTableSkeleton rows={4} />
    </Page>
  );
}

function AdminClassesPage() {
  const search = Route.useSearch();
  const { data, isFetching, isPlaceholderData } = useQuery(
    adminClassesQueryOptions(adminClassesInputFromSearch(search)),
  );
  return (
    <Page
      title={sectionOf("admin", "classes").label()}
      description={<p>{m.classes_admin_description()}</p>}
      actions={<AdminCreateClassDialog />}
    >
      {data ? (
        <AdminClassesTable page={data} search={search} fetching={isFetching && isPlaceholderData} />
      ) : (
        <DataTableSkeleton rows={4} />
      )}
    </Page>
  );
}
