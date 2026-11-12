// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ActivityTable } from "@/components/admin-activity/activity-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminActivityQueryOptions } from "@/server/activity/query-options";
import { activityListSearchSchema } from "@/server/activity/schemas";
import { listInputFromSearch } from "@/server/activity/table-state";
import { providerLabelsQueryOptions } from "@/server/idp/query-options";

export const Route = createFileRoute("/_authed/admin/activity")({
  validateSearch: activityListSearchSchema,
  loaderDeps: ({ search }) => listInputFromSearch(search),
  loader: async ({ context, deps, cause }) => {
    const page = context.queryClient.ensureQueryData(adminActivityQueryOptions(deps));
    // The provider names label the sign-in methods and provider targets (ADR 0015).
    const labels = context.queryClient.ensureQueryData(providerLabelsQueryOptions());
    // NOTE: #58: on a new filter or page the table stays and shows "Updating…"
    // (keepPreviousData) instead of blocking the navigation; entering the page waits for it.
    if (cause === "stay") return void page.catch(() => undefined);
    await Promise.all([page, labels]);
  },
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "activity")) }],
  }),
  pendingComponent: ActivityPendingPage,
  errorComponent: RouteErrorState,
  component: ActivityPage,
});

function ActivityPendingPage() {
  const section = sectionOf("admin", "activity");
  return (
    <Page title={section.label()} description={<p>{m.admin_activity_description()}</p>}>
      <DataTableSkeleton />
    </Page>
  );
}

function ActivityPage() {
  const search = Route.useSearch();
  const section = sectionOf("admin", "activity");
  const { data, isFetching, isPlaceholderData } = useQuery(
    adminActivityQueryOptions(listInputFromSearch(search)),
  );
  return (
    <Page title={section.label()} description={<p>{m.admin_activity_description()}</p>}>
      {data ? (
        <ActivityTable page={data} search={search} fetching={isFetching && isPlaceholderData} />
      ) : (
        <DataTableSkeleton />
      )}
    </Page>
  );
}
