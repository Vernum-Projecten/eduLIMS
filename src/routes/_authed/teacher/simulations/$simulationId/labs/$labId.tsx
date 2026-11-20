// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { LabResultsSection } from "@/components/results/lab-results-section";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { JoinCodePanel } from "@/components/simulations/join-code-panel";
import { BackToSimulation, LabActions } from "@/components/simulations/lab-actions";
import { LabLogoSection } from "@/components/simulations/lab-logo-section";
import { MembersSection } from "@/components/simulations/members-section";
import { SimulationNotFound, simulationPageTitle } from "@/components/simulations/not-found";
import { PastePanel } from "@/components/simulations/paste-panel";
import { WaitingSection } from "@/components/simulations/waiting-section";
import { LabTolerancesSection } from "@/components/tolerances/lab-tolerances-section";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { labResultsQueryOptions } from "@/server/results/query-options";
import { joinCodeQueryOptions, labPageQueryOptions } from "@/server/simulations/query-options";
import { labTolerancesQueryOptions } from "@/server/tolerances/query-options";
import { labPageSearch } from "@/server/tolerances/schemas";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/labs/$labId")({
  validateSearch: labPageSearch,
  loaderDeps: ({ search }) => ({ changes: search.changes ?? 1 }),
  loader: async ({ context, params, deps, cause }) => {
    const tolerances = labTolerancesQueryOptions(params.simulationId, params.labId, deps.changes);
    // Another page of changes keeps the page on screen while it loads (TanStack rule, lists).
    if (cause === "stay") void context.queryClient.prefetchQuery(tolerances);
    const page = await context.queryClient.ensureQueryData(
      labPageQueryOptions(params.simulationId, params.labId),
    );
    // A lab of another simulation under this simulation's address is not this page.
    if (page.simulation.id !== params.simulationId) throw notFound();
    await Promise.all([
      context.queryClient.ensureQueryData(joinCodeQueryOptions(params.simulationId, params.labId)),
      context.queryClient.ensureQueryData(
        labResultsQueryOptions(params.simulationId, params.labId),
      ),
      cause === "stay" ? undefined : context.queryClient.ensureQueryData(tolerances),
    ]);
    return { crumb: page.name, simulation: page.simulation.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationPageTitle(
          match.status,
          loaderData ? `${loaderData.crumb} | ${loaderData.simulation}` : m.labs_page_title(),
        ),
      },
    ],
  }),
  pendingComponent: LabPending,
  errorComponent: RouteErrorState,
  notFoundComponent: SimulationNotFound,
  component: LabPage,
});

function LabPending() {
  const { simulationId } = Route.useParams();
  return (
    <Page title={m.labs_page_title()} actions={<BackToSimulation simulationId={simulationId} />}>
      <Skeleton className="h-6 w-40" />
      <DataTableSkeleton rows={3} />
      <Skeleton className="h-40 w-full" />
    </Page>
  );
}

function LabPage() {
  const { simulationId, labId } = Route.useParams();
  const { changes } = Route.useSearch();
  const { data: page, isFetching } = useSuspenseQuery(labPageQueryOptions(simulationId, labId));
  return (
    <Page
      title={page.name}
      description={<p>{m.labs_page_description({ simulation: page.simulation.name })}</p>}
      actions={<LabActions simulation={page.simulation} lab={page} />}
    >
      <LabLogoSection
        key={page.id}
        lab={{
          simulationId: page.simulation.id,
          labId: page.id,
          labName: page.name,
          logoVersion: page.logoVersion,
        }}
      />
      <MembersSection page={page} busy={isFetching} />
      <PastePanel simulationId={page.simulation.id} labId={page.id} labName={page.name} />
      <WaitingSection page={page} busy={isFetching} />
      <JoinCodePanel simulationId={page.simulation.id} labId={page.id} labName={page.name} />
      <LabTolerancesSection
        simulationId={page.simulation.id}
        labId={page.id}
        labName={page.name}
        changesPage={changes ?? 1}
      />
      <LabResultsSection simulationId={page.simulation.id} labId={page.id} />
    </Page>
  );
}
