// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { NoActiveTeacherAlert } from "@/components/admin-simulations/no-active-teacher";
import {
  AdminLabsSection,
  AdminSimulationNotFound,
  AdminTeachersSection,
  BackToAdminSimulations,
} from "@/components/admin-simulations/simulation-detail";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { formatDate } from "@/lib/i18n/format";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminSimulationQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/admin/simulations/$simulationId")({
  loader: async ({ context, params }) => {
    const simulation = await context.queryClient.ensureQueryData(
      adminSimulationQueryOptions(params.simulationId),
    );
    return { crumb: simulation.name };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.crumb ?? m.simulations_page_title()} | ${sectionOf("admin", "simulations").label()} | ${portalNavigation("admin").label()} | eduLIMS`,
      },
    ],
  }),
  pendingComponent: SimulationPending,
  errorComponent: RouteErrorState,
  notFoundComponent: AdminSimulationNotFound,
  component: SimulationPage,
});

function SimulationPending() {
  return (
    <Page title={m.simulations_page_title()} actions={<BackToAdminSimulations />}>
      <Skeleton className="h-6 w-40" />
      <DataTableSkeleton rows={3} />
    </Page>
  );
}

/** One simulation as an administrator sees it: its teachers and its labs, read-only (B5). */
function SimulationPage() {
  const { simulationId } = Route.useParams();
  const { data: simulation, isFetching } = useSuspenseQuery(
    adminSimulationQueryOptions(simulationId),
  );
  return (
    <Page
      title={simulation.name}
      description={
        <p>{m.admin_simulations_detail_description({ date: formatDate(simulation.createdAt) })}</p>
      }
      actions={<BackToAdminSimulations />}
    >
      {!simulation.hasActiveTeacher && <NoActiveTeacherAlert />}
      <AdminTeachersSection simulation={simulation} />
      <AdminLabsSection simulation={simulation} busy={isFetching} />
    </Page>
  );
}
