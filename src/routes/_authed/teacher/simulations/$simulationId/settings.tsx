// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { simulationSubpageTitle } from "@/components/simulations/not-found";
import { DeleteSimulation, RenameSimulation } from "@/components/simulations/simulation-actions";
import { TeachersSection } from "@/components/simulations/teachers-section";
import { m } from "@/i18n/messages";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/settings")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(
      simulationPageQueryOptions(params.simulationId),
    );
    return { crumb: m.simulation_nav_settings(), simulation: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationSubpageTitle(
          match.status,
          m.simulation_nav_settings(),
          loaderData?.simulation,
        ),
      },
    ],
  }),
  pendingComponent: SettingsPending,
  errorComponent: RouteErrorState,
  component: SettingsPage,
});

function SettingsPending() {
  return (
    <PageFrame
      title={m.simulation_nav_settings()}
      description={m.simulation_settings_description()}
    >
      <DataTableSkeleton rows={2} />
    </PageFrame>
  );
}

const NAME_HEADING = "name-heading";
const DELETE_HEADING = "delete-heading";

/** The settings of a simulation (D10, #381): its name, its teachers, and deleting it. */
function SettingsPage() {
  const { simulationId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const { data: page, isFetching } = useSuspenseQuery(simulationPageQueryOptions(simulationId));
  return (
    <PageFrame
      title={m.simulation_nav_settings()}
      description={m.simulation_settings_description()}
    >
      <div className="flex flex-col gap-10">
        <section aria-labelledby={NAME_HEADING} className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={NAME_HEADING} className="font-semibold text-lg">
                {m.simulations_name()}
              </h2>
              <p className="break-words">{page.name}</p>
            </div>
            <RenameSimulation simulationId={page.id} name={page.name} />
          </div>
        </section>
        <TeachersSection page={page} userId={user.id} busy={isFetching} />
        <section aria-labelledby={DELETE_HEADING} className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={DELETE_HEADING} className="font-semibold text-lg">
                {m.simulations_delete()}
              </h2>
              <p className="max-w-prose text-muted-foreground">
                {m.simulation_settings_delete_body()}
              </p>
            </div>
            <DeleteSimulation simulationId={page.id} name={page.name} />
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
