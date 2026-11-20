// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { CorrectionLogTable } from "@/components/lab-records/correction-log-section";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { simulationSubpageTitle } from "@/components/simulations/not-found";
import { m } from "@/i18n/messages";
import { correctionLogQueryOptions } from "@/server/lab-records/query-options";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/corrections")({
  loader: async ({ context, params }) => {
    const [page] = await Promise.all([
      context.queryClient.ensureQueryData(simulationPageQueryOptions(params.simulationId)),
      context.queryClient.ensureQueryData(correctionLogQueryOptions(params.simulationId)),
    ]);
    return { crumb: m.simulation_nav_corrections(), simulation: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationSubpageTitle(
          match.status,
          m.simulation_nav_corrections(),
          loaderData?.simulation,
        ),
      },
    ],
  }),
  pendingComponent: CorrectionsPending,
  errorComponent: RouteErrorState,
  component: CorrectionsPage,
});

function CorrectionsPending() {
  return (
    <PageFrame
      title={m.simulation_nav_corrections()}
      description={m.simulation_corrections_description()}
    >
      <DataTableSkeleton rows={4} />
    </PageFrame>
  );
}

/** The correction log of a simulation (S11, S12, #381): every lab's corrections, newest first. */
function CorrectionsPage() {
  const { simulationId } = Route.useParams();
  return (
    <PageFrame
      title={m.simulation_nav_corrections()}
      description={m.simulation_corrections_description()}
    >
      <CorrectionLogTable simulationId={simulationId} />
    </PageFrame>
  );
}
