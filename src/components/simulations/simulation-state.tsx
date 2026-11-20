// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleCheckBigIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  FlagIcon,
  type LucideIcon,
  PlayIcon,
} from "lucide-react";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { simulationStateLabel } from "@/lib/i18n/simulation-labels";
import type { SimulationState } from "@/lib/simulations";
import { correctValuesInvalidation } from "@/server/correct-values/query-options";
import { finishSimulationFn, startSimulationFn } from "@/server/simulations/functions";
import type { TeacherSimulationPage } from "@/server/simulations/queries";
import { simulationMutationOptions } from "@/server/simulations/query-options";

const STATE_HEADING = "state-heading";

/** The icon of each state, beside its text (WCAG 1.4.1). */
const STATE_ICONS: Record<SimulationState, LucideIcon> = {
  prepared: CircleDashedIcon,
  running: CirclePlayIcon,
  finished: CircleCheckBigIcon,
};

/** A simulation's state as a badge with an icon and text (D10, #267). */
export function SimulationStateBadge({ state }: Readonly<{ state: SimulationState }>) {
  const Icon = STATE_ICONS[state];
  return (
    <Badge variant={state === "running" ? "default" : "outline"}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {simulationStateLabel(state)}
    </Badge>
  );
}

function stateDescription(state: SimulationState): string {
  switch (state) {
    case "prepared":
      return m.simulations_state_prepared_description();
    case "running":
      return m.simulations_state_running_description();
    case "finished":
      return m.simulations_state_finished_description();
    default: {
      const unknown: never = state;
      return unknown;
    }
  }
}

/**
 * The state of a simulation (D10, #267): what it means for the labs, when it started and ended,
 * and the one step that comes next, behind a confirmation because no step goes back.
 */
export function SimulationStateSection({ page }: Readonly<{ page: TeacherSimulationPage }>) {
  return (
    <section aria-labelledby={STATE_HEADING} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={STATE_HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.simulations_state_heading()}
        </h2>
        <SimulationStateBadge state={page.state} />
      </div>
      <p className="text-muted-foreground">{stateDescription(page.state)}</p>
      {(page.startedAt || page.finishedAt) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {page.startedAt && (
            <>
              <dt className="text-muted-foreground">{m.simulations_started_at()}</dt>
              <dd>
                <time dateTime={page.startedAt}>{formatDateTime(page.startedAt)}</time>
              </dd>
            </>
          )}
          {page.finishedAt && (
            <>
              <dt className="text-muted-foreground">{m.simulations_finished_at()}</dt>
              <dd>
                <time dateTime={page.finishedAt}>{formatDateTime(page.finishedAt)}</time>
              </dd>
            </>
          )}
        </dl>
      )}
      <StateStep simulationId={page.id} name={page.name} state={page.state} />
    </section>
  );
}

function StateStep({
  simulationId,
  name,
  state,
}: Readonly<{ simulationId: string; name: string; state: SimulationState }>) {
  const confirmation = useConfirmation(STATE_HEADING);
  const queryClient = useQueryClient();
  const callStart = useServerFn(startSimulationFn);
  const callFinish = useServerFn(finishSimulationFn);
  const keys = correctValuesInvalidation.state(simulationId);
  const feedback = { onDone: confirmation.done, onFailed: confirmation.failed };
  const start = useSimulationAction(simulationMutationOptions(queryClient, callStart, keys), {
    ...feedback,
    success: () => m.simulations_started({ name }),
  });
  const finish = useSimulationAction(simulationMutationOptions(queryClient, callFinish, keys), {
    ...feedback,
    success: () => m.simulations_finished({ name }),
  });
  if (state === "finished") return null;
  const starting = state === "prepared";
  const pending = start.isPending || finish.isPending;
  const Icon = starting ? PlayIcon : FlagIcon;
  return (
    <div>
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant={starting ? "default" : "outline"}
        disabled={pending}
        onClick={confirmation.show}
      >
        <Icon aria-hidden="true" data-icon="inline-start" />
        {starting ? m.simulations_start() : m.simulations_finish()}
      </Button>
      <ConfirmDialog
        confirmation={confirmation}
        title={
          starting ? m.simulations_start_title({ name }) : m.simulations_finish_title({ name })
        }
        body={starting ? m.simulations_start_body() : m.simulations_finish_body()}
        confirm={starting ? m.simulations_start_confirm() : m.simulations_finish_confirm()}
        pending={pending}
        onConfirm={() =>
          starting ? start.mutate({ simulationId }) : finish.mutate({ simulationId })
        }
      />
    </div>
  );
}
