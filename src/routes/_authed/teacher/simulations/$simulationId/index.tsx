// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { simulationPageTitle } from "@/components/simulations/not-found";
import {
  PreparationChecklist,
  RunningOverview,
} from "@/components/simulations/simulation-overview";
import {
  SimulationPrimaryAction,
  stateDescription,
} from "@/components/simulations/simulation-state";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import {
  simulationPageQueryOptions,
  simulationReadinessQueryOptions,
} from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/")({
  loader: async ({ context, params }) => {
    const [page] = await Promise.all([
      context.queryClient.ensureQueryData(simulationPageQueryOptions(params.simulationId)),
      context.queryClient.ensureQueryData(simulationReadinessQueryOptions(params.simulationId)),
    ]);
    return { crumb: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationPageTitle(match.status, loaderData?.crumb ?? m.simulations_page_title()),
      },
    ],
  }),
  pendingComponent: OverviewPending,
  errorComponent: RouteErrorState,
  component: OverviewPage,
});

function OverviewPending() {
  return (
    <PageFrame title={m.simulation_nav_overview()} description={m.simulation_overview_loading()}>
      <Skeleton className="h-48 w-full" />
    </PageFrame>
  );
}

/** The overview (#381): the state, the one next step, and the start or the finish. */
function OverviewPage() {
  const { simulationId } = Route.useParams();
  const { data: page } = useSuspenseQuery(simulationPageQueryOptions(simulationId));
  const { data: readiness } = useSuspenseQuery(simulationReadinessQueryOptions(simulationId));
  return (
    <PageFrame
      title={m.simulation_nav_overview()}
      description={stateDescription(readiness.state)}
      action={<SimulationPrimaryAction name={page.name} readiness={readiness} />}
    >
      {readiness.state === "prepared" ? (
        <PreparationChecklist readiness={readiness} />
      ) : (
        <RunningOverview readiness={readiness} />
      )}
    </PageFrame>
  );
}
