// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { LabsSection } from "@/components/simulations/labs-section";
import { SimulationNotFound } from "@/components/simulations/not-found";
import { BackToSimulations, SimulationActions } from "@/components/simulations/simulation-actions";
import { TeachersSection } from "@/components/simulations/teachers-section";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { formatDate } from "@/lib/i18n/format";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(
      simulationPageQueryOptions(params.simulationId),
    );
    return { crumb: page.name };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.crumb ?? m.simulations_page_title()} | ${sectionOf("teacher", "simulations").label()} | ${portalNavigation("teacher").label()} | eduLIMS`,
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
      <LabsSection page={page} busy={isFetching} />
      <TeachersSection page={page} userId={user.id} busy={isFetching} />
    </Page>
  );
}
