// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EyeOffIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { useGridPaste } from "@/components/correct-values/grid-paste";
import { type GridStatus, ValuesGrid } from "@/components/correct-values/values-grid";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { PageFrame } from "@/components/shell/page-frame";
import { RouteErrorState } from "@/components/shell/route-error";
import { simulationSubpageTitle } from "@/components/simulations/not-found";
import { Button } from "@/components/ui/button";
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
/** Takes a clear back; the grid then says so in the same status line (WCAG 3.3.4). */
function UndoButton({ undo }: Readonly<{ undo: () => Promise<void> }>) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void undo().finally(() => setPending(false));
      }}
    >
      <Undo2Icon aria-hidden="true" data-icon="inline-start" />
      {m.correct_values_grid_undo()}
    </Button>
  );
}

function ValuesPage() {
  const { simulationId } = Route.useParams();
  const { data: page } = useSuspenseQuery(correctValuesQueryOptions(simulationId));
  // What the last save, clear or paste did, in the page's one status line (WCAG 4.1.3): each
  // gets its own key, so a repeat of the same words is announced again.
  const [status, setStatus] = useState<{ key: number; value: GridStatus } | null>(null);
  const show = (value: GridStatus) =>
    setStatus((previous) => ({ key: (previous?.key ?? 0) + 1, value }));
  const paste = useGridPaste(simulationId, show);
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
      <div role="status" className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
        {status && <span key={status.key}>{status.value.message}</span>}
        {status?.value.undo && <UndoButton undo={status.value.undo} />}
      </div>
      <ValuesGrid simulationId={simulationId} emptyAction={paste.button} onSaved={show} />
      {paste.dialog}
    </PageFrame>
  );
}
