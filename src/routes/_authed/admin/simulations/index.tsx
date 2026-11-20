// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AdminSimulationsTable } from "@/components/admin-simulations/simulations-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminSimulationListSearchSchema } from "@/server/simulations/admin-schemas";
import { adminSimulationListInput } from "@/server/simulations/admin-table-state";
import { adminSimulationsQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/admin/simulations/")({
  validateSearch: adminSimulationListSearchSchema,
  loaderDeps: ({ search }) => adminSimulationListInput(search),
  loader: async ({ context, deps, cause }) => {
    const page = context.queryClient.ensureQueryData(adminSimulationsQueryOptions(deps));
    // NOTE: #58: on a new search or page the list stays and shows "Updating…"
    // (keepPreviousData) instead of blocking the navigation; entering the page waits for it.
    if (cause === "stay") return void page.catch(() => undefined);
    await page;
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "simulations")) },
    ],
  }),
  pendingComponent: SimulationsPendingPage,
  errorComponent: RouteErrorState,
  component: SimulationsPage,
});

function SimulationsPendingPage() {
  const section = sectionOf("admin", "simulations");
  return (
    <Page title={section.label()} description={<p>{m.admin_simulations_page_description()}</p>}>
      <DataTableSkeleton rows={5} />
    </Page>
  );
}

/** The administrator's read-only list of simulations (B5, #291). */
function SimulationsPage() {
  const search = Route.useSearch();
  const section = sectionOf("admin", "simulations");
  const simulations = useQuery(adminSimulationsQueryOptions(adminSimulationListInput(search)));
  return (
    <Page title={section.label()} description={<p>{m.admin_simulations_page_description()}</p>}>
      {simulations.data ? (
        <AdminSimulationsTable
          page={simulations.data}
          search={search}
          fetching={simulations.isFetching && simulations.isPlaceholderData}
        />
      ) : (
        <DataTableSkeleton rows={5} />
      )}
    </Page>
  );
}
