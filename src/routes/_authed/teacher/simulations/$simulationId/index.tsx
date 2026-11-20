// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CorrectValuesSection } from "@/components/correct-values/correct-values-section";
import { LimitsSection } from "@/components/correct-values/limits-section";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { CorrectionLogSection } from "@/components/lab-records/correction-log-section";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { LabsSection } from "@/components/simulations/labs-section";
import { SimulationNotFound, simulationPageTitle } from "@/components/simulations/not-found";
import { BackToSimulations, SimulationActions } from "@/components/simulations/simulation-actions";
import { SimulationStateSection } from "@/components/simulations/simulation-state";
import { TeachersSection } from "@/components/simulations/teachers-section";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { formatDate } from "@/lib/i18n/format";
import { correctValuesQueryOptions } from "@/server/correct-values/query-options";
import { correctionLogQueryOptions } from "@/server/lab-records/query-options";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/")({
  loader: async ({ context, params }) => {
    const [page] = await Promise.all([
      context.queryClient.ensureQueryData(simulationPageQueryOptions(params.simulationId)),
      context.queryClient.ensureQueryData(correctValuesQueryOptions(params.simulationId)),
      context.queryClient.ensureQueryData(correctionLogQueryOptions(params.simulationId)),
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
  pendingComponent: SimulationPending,
  errorComponent: RouteErrorState,
  notFoundComponent: SimulationNotFound,
  component: SimulationPage,
});

function SimulationPending() {
  return (
    <Page title={m.simulations_page_title()} actions={<BackToSimulations />}>
      <Skeleton className="h-6 w-40" />
      <DataTableSkeleton rows={3} />
      <DataTableSkeleton rows={3} />
      <DataTableSkeleton rows={2} />
    </Page>
  );
}

function SimulationPage() {
  const { simulationId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const { data: page, isFetching } = useSuspenseQuery(simulationPageQueryOptions(simulationId));
  return (
    <Page
      title={page.name}
      description={
        <p>
          {m.simulations_created_on({ date: formatDate(page.createdAt) })}{" "}
          {m.simulations_page_description_detail()}
        </p>
      }
      actions={<SimulationActions simulationId={page.id} name={page.name} />}
    >
      <SimulationStateSection page={page} />
      <CorrectValuesSection simulationId={page.id} />
      <LimitsSection simulationId={page.id} />
      <LabsSection page={page} busy={isFetching} />
      <TeachersSection page={page} userId={user.id} busy={isFetching} />
      <CorrectionLogSection simulationId={page.id} />
    </Page>
  );
}
