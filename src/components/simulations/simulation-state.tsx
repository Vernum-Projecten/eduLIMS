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
import { firstBlockingStep, stepHeadingId } from "@/components/simulations/preparation-steps";
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
import type { StartRefusal } from "@/server/simulations/state";

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
 * Returns the toast of a refused start: the tests without limits by name when the screen knows
 * them, and the code's own message otherwise (#267).
 */
export function startErrorMessage(error: Error, names: ReadonlyMap<string, string>): string {
  const code = simulationErrorCode(error);
  return code === "missing_limits"
    ? missingLimitsMessage(refusedTestIds(error), names)
    : simulationErrorMessage(code);
}

/** The text beside a blocked Start, and the page that removes the block, by reason (#394). */
function BlockedReason({
  simulationId,
  refusal,
}: Readonly<{ simulationId: string; refusal: StartRefusal }>) {
  const link = "font-medium text-foreground underline underline-offset-4";
  switch (refusal.error) {
    case "no_students":
      return (
        <span>
          {m.simulation_start_blocked_students()}{" "}
          <Link
            to="/teacher/simulations/$simulationId/labs"
            params={{ simulationId }}
            className={link}
          >
            {m.simulation_open_labs()}
          </Link>
        </span>
      );
    case "no_correct_values":
    case "missing_limits":
      return (
        <span>
          {refusal.error === "missing_limits"
            ? m.simulation_start_blocked()
            : m.simulation_start_blocked_values()}{" "}
          <Link
            to="/teacher/simulations/$simulationId/values"
            params={{ simulationId }}
            className={link}
          >
            {m.simulation_start_blocked_link()}
          </Link>
        </span>
      );
    default:
      return <span>{simulationErrorMessage(refusal.error)}</span>;
  }
}

/**
 * The one step that comes next for a simulation (D10, #267, #381): Start while it is prepared,
 * Finish while it runs, nothing once it is finished. While the server's read says the start
 * would be refused, Start stays focusable with `aria-disabled` and its reason beside it, and a
 * click moves focus to the first step that blocks it. Both steps ask first, because no step
 * goes back; the server refuses a start again on its own.
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
    errorMessage: (error) => startErrorMessage(error, names),
  });
  const finish = useSimulationAction(simulationMutationOptions(queryClient, callFinish, keys), {
    ...feedback,
    success: () => m.simulations_finished({ name }),
  });
  if (state === "finished") return null;
  const starting = state === "prepared";
  const refusal = starting ? startRefusal : null;
  const pending = start.isPending || finish.isPending;
  const Icon = starting ? PlayIcon : FlagIcon;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant={starting ? "default" : "outline"}
        aria-disabled={pending || refusal !== null || undefined}
        aria-describedby={refusal ? START_BLOCKED : undefined}
        className="aria-disabled:opacity-50"
        onClick={() => {
          if (pending) return;
          if (refusal) {
            document.getElementById(stepHeadingId(firstBlockingStep(readiness)))?.focus();
            return;
          }
          confirmation.show();
        }}
      >
        <Icon aria-hidden="true" data-icon="inline-start" />
        {starting ? m.simulations_start() : m.simulations_finish()}
      </Button>
      {refusal && (
        <p
          id={START_BLOCKED}
          className="inline-flex max-w-xs items-start gap-1.5 text-muted-foreground text-sm"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <BlockedReason simulationId={simulationId} refusal={refusal} />
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
