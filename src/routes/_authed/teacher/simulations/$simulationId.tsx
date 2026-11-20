// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RouteErrorState } from "@/components/shell/route-error";
import { SimulationNotFound, simulationPageTitle } from "@/components/simulations/not-found";
import { SimulationWorkspace } from "@/components/simulations/simulation-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

// The frame of a simulation's pages (D10, #381): its name and state, and
// the navigation between overview, labs, correct values, dashboard, corrections and settings.
export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(
      simulationPageQueryOptions(params.simulationId),
    );
    return { crumb: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationPageTitle(match.status, loaderData?.crumb ?? m.simulations_page_title()),
      },
    ],
  }),
  pendingComponent: SimulationPending,
  errorComponent: RouteErrorState,
  notFoundComponent: SimulationNotFound,
  component: SimulationLayout,
});

function SimulationPending() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function SimulationLayout() {
  const { simulationId } = Route.useParams();
  // One simulation per mount: another simulation's address starts with fresh dialogs and state.
  return <Workspace key={simulationId} simulationId={simulationId} />;
}

function Workspace({ simulationId }: Readonly<{ simulationId: string }>) {
  const { data: page } = useSuspenseQuery(simulationPageQueryOptions(simulationId));
  return (
    <SimulationWorkspace page={page}>
      <Outlet />
    </SimulationWorkspace>
  );
}
