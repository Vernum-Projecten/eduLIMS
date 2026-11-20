// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { LabsTable, useCreateLab } from "@/components/simulations/labs-section";
import { simulationSubpageTitle } from "@/components/simulations/not-found";
import { m } from "@/i18n/messages";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/labs/")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(
      simulationPageQueryOptions(params.simulationId),
    );
    return { crumb: m.simulation_nav_labs(), simulation: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationSubpageTitle(
          match.status,
          m.simulation_nav_labs(),
          loaderData?.simulation,
        ),
      },
    ],
  }),
  pendingComponent: LabsPending,
  errorComponent: RouteErrorState,
  component: LabsPage,
});

function LabsPending() {
  return (
    <PageFrame title={m.simulation_nav_labs()} description={m.labs_description()}>
      <DataTableSkeleton rows={3} />
    </PageFrame>
  );
}

/** The labs of a simulation (D10, #381): the list, with creating a lab as the one action. */
function LabsPage() {
  const { simulationId } = Route.useParams();
  const { data: page, isFetching } = useSuspenseQuery(simulationPageQueryOptions(simulationId));
  const create = useCreateLab(page.id);
  return (
    <PageFrame
      title={m.simulation_nav_labs()}
      description={m.labs_description()}
      // With no lab yet, the empty state holds the one action instead (#384).
      action={page.labs.length > 0 ? create.button : undefined}
    >
      <LabsTable page={page} busy={isFetching} emptyAction={create.button} />
      {create.dialog}
    </PageFrame>
  );
}
