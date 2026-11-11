// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { UsersTable } from "@/components/admin-users/users-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { providerLabelsQueryOptions } from "@/server/idp/query-options";
import { adminUsersQueryOptions } from "@/server/users/query-options";
import { userListSearchSchema } from "@/server/users/schemas";
import { listInputFromSearch } from "@/server/users/table-state";

export const Route = createFileRoute("/_authed/admin/users")({
  validateSearch: userListSearchSchema,
  loaderDeps: ({ search }) => listInputFromSearch(search),
  loader: async ({ context, deps, cause }) => {
    const page = context.queryClient.ensureQueryData(adminUsersQueryOptions(deps));
    // The provider names label the role sources and sign-in methods (ADR 0015).
    const labels = context.queryClient.ensureQueryData(providerLabelsQueryOptions());
    // NOTE: #58: on a new sort, filter or page the table stays and shows "Updating…"
    // (keepPreviousData) instead of blocking the navigation; entering the page waits for it.
    if (cause === "stay") return void page.catch(() => undefined);
    await Promise.all([page, labels]);
  },
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "users")) }],
  }),
  pendingComponent: UsersPendingPage,
  errorComponent: RouteErrorState,
  component: UsersPage,
});

function UsersPendingPage() {
  const section = sectionOf("admin", "users");
  return (
    <Page title={section.label()} description={<p>{m.admin_users_description()}</p>}>
      <DataTableSkeleton />
    </Page>
  );
}

function UsersPage() {
  const search = Route.useSearch();
  const { user } = Route.useRouteContext();
  const section = sectionOf("admin", "users");
  const { data, isFetching, isPlaceholderData } = useQuery(
    adminUsersQueryOptions(listInputFromSearch(search)),
  );

  return (
    <Page title={section.label()} description={<p>{m.admin_users_description()}</p>}>
      {data ? (
        <UsersTable
          page={data}
          search={search}
          selfId={user.id}
          fetching={isFetching && isPlaceholderData}
        />
      ) : (
        <DataTableSkeleton />
      )}
      <Outlet />
    </Page>
  );
}
