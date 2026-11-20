// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { useGridPaste } from "@/components/correct-values/grid-paste";
import { ValuesGrid } from "@/components/correct-values/values-grid";
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
 * The correct values and accuracy limits of a simulation as one grid (D10, D13, #401): pasted
 * from a spreadsheet, then edited cell by cell. Teacher-scoped: a student never reaches this page
 * or its data (Q-SIM-1).
 */
function ValuesPage() {
  const { simulationId } = Route.useParams();
  const { data: page } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  // What the last save or paste did, in the page itself: the toasts sit below a dialog's
  // overlay, so a status line on the page says it too (WCAG 4.1.3).
  const [saved, setSaved] = useState("");
  const paste = useGridPaste(simulationId, setSaved);
  return (
    <PageFrame
      title={m.simulation_nav_values()}
      description={m.simulation_values_description()}
      // With no test yet, the empty state holds the one action instead (#384).
      action={page.tests.length > 0 ? paste.button : undefined}
    >
      <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
        <EyeOffIcon aria-hidden="true" className="size-4 shrink-0" />
        {m.correct_values_secret()}
      </p>
      <p role="status" className="text-sm empty:hidden">
        {saved}
      </p>
      <ValuesGrid simulationId={simulationId} emptyAction={paste.button} onSaved={setSaved} />
      {paste.dialog}
    </PageFrame>
  );
}
