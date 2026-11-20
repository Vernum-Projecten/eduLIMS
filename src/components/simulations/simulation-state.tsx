// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleCheckBigIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  FlagIcon,
  type LucideIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { PAGE_TITLE_ID } from "@/components/shell/page-header";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import {
  missingLimitsMessage,
  simulationErrorMessage,
  simulationStateLabel,
} from "@/lib/i18n/simulation-labels";
import type { SimulationState } from "@/lib/simulations";
import { correctValuesInvalidation } from "@/server/correct-values/query-options";
import { finishSimulationFn, startSimulationFn } from "@/server/simulations/functions";
import {
  refusedTestIds,
  simulationErrorCode,
  simulationMutationOptions,
} from "@/server/simulations/query-options";
import type { SimulationReadiness } from "@/server/simulations/readiness";

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

/** Returns what a state means for the labs, in one sentence. */
export function stateDescription(state: SimulationState): string {
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

const START_BLOCKED = "start-blocked";

/**
 * The one step that comes next for a simulation (D10, #267, #381): Start while it is prepared,
 * Finish while it runs, nothing once it is finished. Start is enabled only when the server's
 * read says the start would succeed, and the reason it would not shows beside it in text. Both
 * steps ask first, because no step goes back; the server refuses a start again on its own.
 */
export function SimulationPrimaryAction({
  name,
  readiness,
}: Readonly<{ name: string; readiness: SimulationReadiness }>) {
  const { simulationId, state, startRefusal } = readiness;
  // Start turns into Finish: after a success focus goes to the page's h1 (WCAG 2.4.3).
  const confirmation = useConfirmation(PAGE_TITLE_ID);
  const queryClient = useQueryClient();
  const callStart = useServerFn(startSimulationFn);
  const callFinish = useServerFn(finishSimulationFn);
  const keys = correctValuesInvalidation.state(simulationId);
  const feedback = { onDone: confirmation.done, onFailed: confirmation.failed };
  const names = new Map(readiness.missingLimits.map((test) => [test.id, test.name]));
  const start = useSimulationAction(simulationMutationOptions(queryClient, callStart, keys), {
    ...feedback,
    success: () => m.simulations_started({ name }),
    errorMessage: (error) =>
      simulationErrorCode(error) === "missing_limits"
        ? missingLimitsMessage(refusedTestIds(error), names)
        : simulationErrorMessage(simulationErrorCode(error)),
  });
  const finish = useSimulationAction(simulationMutationOptions(queryClient, callFinish, keys), {
    ...feedback,
    success: () => m.simulations_finished({ name }),
  });
  if (state === "finished") return null;
  const starting = state === "prepared";
  const blocked = starting && startRefusal !== null;
  const pending = start.isPending || finish.isPending;
  const Icon = starting ? PlayIcon : FlagIcon;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant={starting ? "default" : "outline"}
        disabled={pending || blocked}
        aria-describedby={blocked ? START_BLOCKED : undefined}
        onClick={confirmation.show}
      >
        <Icon aria-hidden="true" data-icon="inline-start" />
        {starting ? m.simulations_start() : m.simulations_finish()}
      </Button>
      {starting && startRefusal !== null && (
        <p
          id={START_BLOCKED}
          className="inline-flex max-w-xs items-start gap-1.5 text-muted-foreground text-sm"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {startRefusal.error === "missing_limits" ? (
            <span>
              {m.simulation_start_blocked()}{" "}
              <Link
                to="/teacher/simulations/$simulationId/values"
                params={{ simulationId }}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {m.simulation_start_blocked_link()}
              </Link>
            </span>
          ) : (
            <span>{simulationErrorMessage(startRefusal.error)}</span>
          )}
        </p>
      )}
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
