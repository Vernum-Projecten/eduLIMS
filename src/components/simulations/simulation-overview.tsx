// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ChartColumnIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  HistoryIcon,
  type LucideIcon,
} from "lucide-react";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import {
  type StepPage,
  type StepStatus,
  stepHeadingId,
  stepsOf,
} from "@/components/simulations/preparation-steps";
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
import { cn } from "@/lib/utils";
import type { SimulationReadiness } from "@/server/simulations/readiness";

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

/** A step's link to its page: an outline button while there is work, a quiet one once done. */
function StepLink({
  simulationId,
  page,
  done,
}: Readonly<{ simulationId: string; page: StepPage; done: boolean }>) {
  const label = page === "labs" ? m.simulation_open_labs() : m.simulation_open_values();
  return (
    <Button asChild variant={done ? "ghost" : "outline"} size="sm">
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
 * server's read, which asks the same rule the start does; nothing is worked out here. Each
 * step's heading takes focus from a blocked Start (WCAG 2.4.3).
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
                  {/* The status and the reason describe the heading a blocked Start focuses. */}
                  <h3
                    id={stepHeadingId(step.id)}
                    tabIndex={-1}
                    aria-describedby={cn(
                      `${stepHeadingId(step.id)}-status`,
                      step.description && `${stepHeadingId(step.id)}-description`,
                    )}
                    className={cn(FOCUSABLE_HEADING, "font-medium text-base")}
                  >
                    {step.title}
                  </h3>
                  <span
                    id={`${stepHeadingId(step.id)}-status`}
                    className={cn("font-normal text-xs", status.className)}
                  >
                    {status.label()}
                  </span>
                </ItemTitle>
                {step.description && (
                  <ItemDescription
                    id={`${stepHeadingId(step.id)}-description`}
                    className="line-clamp-none break-words"
                  >
                    {step.description}
                  </ItemDescription>
                )}
              </ItemContent>
              {step.page && (
                <ItemActions>
                  <StepLink
                    simulationId={readiness.simulationId}
                    page={step.page}
                    done={step.status === "done"}
                  />
                </ItemActions>
              )}
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}

/**
 * The overview of a simulation that runs or ran: while it runs, where to follow the labs; once
 * it is finished, the dashboard has nothing live to show, so it points to the corrections.
 */
export function RunningOverview({ readiness }: Readonly<{ readiness: SimulationReadiness }>) {
  const running = readiness.state === "running";
  const Icon = running ? ChartColumnIcon : HistoryIcon;
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Icon aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none whitespace-normal">
          <h2 className="font-medium">
            {running ? m.simulation_follow_heading() : m.simulation_review_heading()}
          </h2>
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-words">
          {running ? m.simulation_follow_running() : m.simulation_follow_finished()}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button asChild variant="outline" size="sm">
          {running ? (
            <Link to="/teacher/dashboard">
              {m.simulation_open_dashboard()}
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
          ) : (
            <Link
              to="/teacher/simulations/$simulationId/corrections"
              params={{ simulationId: readiness.simulationId }}
            >
              {m.simulation_open_corrections()}
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
          )}
        </Button>
      </ItemActions>
    </Item>
  );
}
