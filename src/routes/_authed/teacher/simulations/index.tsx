// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { CreateSimulation, SimulationsList } from "@/components/simulations/simulations-list";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { mySimulationsQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(mySimulationsQueryOptions()),
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "simulations")) },
    ],
  }),
  pendingComponent: SimulationsPending,
  errorComponent: RouteErrorState,
  component: SimulationsPage,
});

function SimulationsPending() {
  const section = sectionOf("teacher", "simulations");
  return (
    <Page title={section.label()} description={<p>{m.simulations_page_description()}</p>}>
      <DataTableSkeleton rows={3} />
    </Page>
  );
}

function SimulationsPage() {
  const section = sectionOf("teacher", "simulations");
  const { data, isFetching } = useSuspenseQuery(mySimulationsQueryOptions());
  return (
    <Page
      title={section.label()}
      description={<p>{m.simulations_page_description()}</p>}
      actions={<CreateSimulation />}
    >
      <SimulationsList rows={data} busy={isFetching} />
    </Page>
  );
}
