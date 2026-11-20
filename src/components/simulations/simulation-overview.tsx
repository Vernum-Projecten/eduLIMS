// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ChartColumnIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { cn } from "@/lib/utils";
import type { SimulationReadiness } from "@/server/simulations/readiness";

/** Where a step of the preparation stands: done, still to do, or what blocks the start. */
type StepStatus = "done" | "todo" | "blocks";

type StepPage = "labs" | "values";

interface Step {
  id: string;
  title: string;
  status: StepStatus;
  description: string;
  page: StepPage | null;
}

/** The icon and the text of each status: never colour alone (WCAG 1.4.1). */
const STATUS: Record<StepStatus, { icon: LucideIcon; label: () => string; className: string }> = {
  done: { icon: CircleCheckIcon, label: () => m.simulation_step_done(), className: "" },
  todo: {
    icon: CircleIcon,
    label: () => m.simulation_step_todo(),
    className: "text-muted-foreground",
  },
  blocks: {
    icon: CircleAlertIcon,
    label: () => m.simulation_step_blocks(),
    className: "text-destructive",
  },
};

function labsStep({ labs }: SimulationReadiness): Step {
  const base = { id: "labs", title: m.simulation_step_labs(), page: "labs" as const };
  if (labs.count === 0) {
    return { ...base, status: "todo", description: m.simulation_step_labs_none() };
  }
  const counts = m.simulation_step_labs_counts({
    labs: formatNumber(labs.count),
    students: formatNumber(labs.students),
    waiting: formatNumber(labs.waiting),
  });
  if (labs.empty > 0) {
    return {
      ...base,
      status: "todo",
      description: `${counts} ${m.simulation_step_labs_empty({ empty: formatNumber(labs.empty) })}`,
    };
  }
  return { ...base, status: "done", description: counts };
}

function valuesStep({ values }: SimulationReadiness): Step {
  const base = { id: "values", title: m.simulation_step_values(), page: "values" as const };
  if (values.count === 0) {
    return { ...base, status: "todo", description: m.simulation_step_values_none() };
  }
  return {
    ...base,
    status: "done",
    description: m.simulation_step_values_counts({
      values: formatNumber(values.count),
      tests: formatNumber(values.tests),
    }),
  };
}

function limitsStep({ values, missingLimits }: SimulationReadiness): Step {
  const base = { id: "limits", title: m.simulation_step_limits(), page: "values" as const };
  if (missingLimits.length > 0) {
    return {
      ...base,
      status: "blocks",
      description: m.simulations_missing_limits({
        tests: missingLimits.map((test) => test.name).join(", "),
      }),
    };
  }
  if (values.count === 0) {
    return { ...base, status: "todo", description: m.simulation_step_limits_waiting() };
  }
  return { ...base, status: "done", description: m.simulation_step_limits_done() };
}

function startStep({ startRefusal }: SimulationReadiness): Step {
  const base = { id: "start", title: m.simulation_step_start(), page: null };
  if (startRefusal === null) {
    return { ...base, status: "todo", description: m.simulation_step_start_ready() };
  }
  // Any reason the start gives shows here as the start would word it (#386 adds one).
  const description =
    startRefusal.error === "missing_limits"
      ? m.simulation_step_start_blocked()
      : simulationErrorMessage(startRefusal.error);
  return { ...base, status: "blocks", description };
}

/** Returns the checklist of a prepared simulation, in the order a teacher works. */
function stepsOf(readiness: SimulationReadiness): Step[] {
  return [labsStep(readiness), valuesStep(readiness), limitsStep(readiness), startStep(readiness)];
}

function StepLink({ simulationId, page }: Readonly<{ simulationId: string; page: StepPage }>) {
  const label = page === "labs" ? m.simulation_open_labs() : m.simulation_open_values();
  return (
    <Button asChild variant="outline" size="sm">
      <Link
        to={
          page === "labs"
            ? "/teacher/simulations/$simulationId/labs"
            : "/teacher/simulations/$simulationId/values"
        }
        params={{ simulationId }}
      >
        {label}
        <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Button>
  );
}

const CHECKLIST_HEADING = "checklist-heading";

/**
 * The preparation of a simulation as a checklist (D10, #381): each step says what is done and
 * what is missing, and links to its page. Every count and the start's verdict come from the
 * server's read, which asks the same rule the start does; nothing is worked out here.
 */
export function PreparationChecklist({ readiness }: Readonly<{ readiness: SimulationReadiness }>) {
  const steps = stepsOf(readiness);
  const next = steps.find((step) => step.status !== "done");
  return (
    <section aria-labelledby={CHECKLIST_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={CHECKLIST_HEADING} className="font-semibold text-lg">
          {m.simulation_checklist_heading()}
        </h2>
        {next && (
          <p className="text-muted-foreground">
            {m.simulation_checklist_next({ step: next.title })}
          </p>
        )}
      </div>
      <ItemGroup className="gap-2">
        {steps.map((step) => {
          const status = STATUS[step.status];
          const Icon = status.icon;
          return (
            <Item
              key={step.id}
              role="listitem"
              variant="outline"
              className={step === next ? "border-foreground/40" : undefined}
            >
              <ItemMedia variant="icon" className={status.className}>
                <Icon aria-hidden="true" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none flex-wrap whitespace-normal">
                  <h3 className="font-medium">{step.title}</h3>
                  <span className={cn("font-normal text-xs", status.className)}>
                    {status.label()}
                  </span>
                </ItemTitle>
                <ItemDescription className="line-clamp-none break-words">
                  {step.description}
                </ItemDescription>
              </ItemContent>
              {step.page && (
                <ItemActions>
                  <StepLink simulationId={readiness.simulationId} page={step.page} />
                </ItemActions>
              )}
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}

/** The overview of a running or finished simulation: where to follow the labs. */
export function RunningOverview({ readiness }: Readonly<{ readiness: SimulationReadiness }>) {
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <ChartColumnIcon aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none whitespace-normal">
          <h2 className="font-medium">{m.simulation_follow_heading()}</h2>
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-words">
          {readiness.state === "running"
            ? m.simulation_follow_running()
            : m.simulation_follow_finished()}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button asChild variant="outline" size="sm">
          <Link to="/teacher/dashboard">
            {m.simulation_open_dashboard()}
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </ItemActions>
    </Item>
  );
}
