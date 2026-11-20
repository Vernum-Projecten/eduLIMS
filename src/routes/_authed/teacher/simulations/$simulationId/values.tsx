// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { EyeOffIcon } from "lucide-react";
import {
  PasteCorrectValues,
  useAddCorrectValue,
  useHasCorrectValues,
  ValuesByTest,
} from "@/components/correct-values/values-by-test";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { simulationSubpageTitle } from "@/components/simulations/not-found";
import { m } from "@/i18n/messages";
import { correctValuesQueryOptions } from "@/server/correct-values/query-options";
import { simulationPageQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/values")({
  loader: async ({ context, params }) => {
    const [page] = await Promise.all([
      context.queryClient.ensureQueryData(simulationPageQueryOptions(params.simulationId)),
      context.queryClient.ensureQueryData(correctValuesQueryOptions(params.simulationId)),
    ]);
    return { crumb: m.simulation_nav_values(), simulation: page.name };
  },
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: simulationSubpageTitle(
          match.status,
          m.simulation_nav_values(),
          loaderData?.simulation,
        ),
      },
    ],
  }),
  pendingComponent: ValuesPending,
  errorComponent: RouteErrorState,
  component: ValuesPage,
});

function ValuesPending() {
  return (
    <PageFrame title={m.simulation_nav_values()} description={m.simulation_values_description()}>
      <DataTableSkeleton rows={3} />
    </PageFrame>
  );
}

/**
 * The correct values and accuracy limits of a simulation (D10, D13, #381), one table per test.
 * Teacher-scoped: a student never reaches this page or its data (Q-SIM-1).
 */
function ValuesPage() {
  const { simulationId } = Route.useParams();
  const filled = useHasCorrectValues(simulationId);
  const add = useAddCorrectValue(simulationId);
  return (
    <PageFrame
      title={m.simulation_nav_values()}
      description={m.simulation_values_description()}
      secondary={<PasteCorrectValues simulationId={simulationId} />}
      action={filled ? add.button : undefined}
    >
      <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
        <EyeOffIcon aria-hidden="true" className="size-4 shrink-0" />
        {m.correct_values_secret()}
      </p>
      <ValuesByTest simulationId={simulationId} emptyAction={add.button} />
      {add.dialog}
    </PageFrame>
  );
}
