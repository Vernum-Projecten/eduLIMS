// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
import { formatList, formatNumber } from "@/lib/i18n/format";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import type { SimulationReadiness } from "@/server/simulations/readiness";

/** Where a step of the preparation stands: done, still to do, or what blocks the start. */
export type StepStatus = "done" | "todo" | "blocks";

/** The page a step links to. */
export type StepPage = "labs" | "values";

/** One step of the overview's checklist, worked out from the server's read alone. */
export interface Step {
  id: "labs" | "values" | "limits" | "start";
  title: string;
  status: StepStatus;
  description: string;
  page: StepPage | null;
}

/** Returns the id of a step's heading, which a blocked Start moves focus to (WCAG 2.4.3). */
export function stepHeadingId(step: Step["id"]): string {
  return `step-${step}`;
}

/** Returns "1 lab, 2 students, 0 addresses waiting." with each count in its own plural. */
function labCounts({ labs }: SimulationReadiness): string {
  const count = (n: number, one: () => string, other: (args: { count: string }) => string) =>
    n === 1 ? one() : other({ count: formatNumber(n) });
  return m.simulation_step_labs_counts({
    labs: count(labs.count, m.simulation_count_labs_one, m.simulation_count_labs_other),
    students: count(
      labs.students,
      m.simulation_count_students_one,
      m.simulation_count_students_other,
    ),
    waiting: count(labs.waiting, m.simulation_count_waiting_one, m.simulation_count_waiting_other),
  });
}

function labsStep(readiness: SimulationReadiness): Step {
  const { labs } = readiness;
  const base = { id: "labs", title: m.simulation_step_labs(), page: "labs" } as const;
  if (labs.count === 0) {
    return { ...base, status: "blocks", description: m.simulation_step_labs_none() };
  }
  const counts = labCounts(readiness);
  // NOTE: owner via coordinator 2026-11-20 on #394; the start needs one student in some lab.
  if (labs.students === 0) {
    return {
      ...base,
      status: "blocks",
      description: `${counts} ${m.simulation_step_labs_no_students()}`,
    };
  }
  if (labs.empty > 0) {
    const empty =
      labs.empty === 1
        ? m.simulation_step_labs_empty_one()
        : m.simulation_step_labs_empty_other({ count: formatNumber(labs.empty) });
    return { ...base, status: "todo", description: `${counts} ${empty}` };
  }
  return { ...base, status: "done", description: counts };
}

function valuesStep({ values }: SimulationReadiness): Step {
  const base = { id: "values", title: m.simulation_step_values(), page: "values" } as const;
  if (values.count === 0) {
    return { ...base, status: "blocks", description: m.simulation_step_values_none() };
  }
  const valueCount =
    values.count === 1
      ? m.simulation_count_values_one()
      : m.simulation_count_values_other({ count: formatNumber(values.count) });
  const testCount =
    values.tests === 1
      ? m.simulation_count_tests_one()
      : m.simulation_count_tests_other({ count: formatNumber(values.tests) });
  return {
    ...base,
    status: "done",
    description: m.simulation_step_values_counts({ values: valueCount, tests: testCount }),
  };
}

function limitsStep({ values, missingLimits }: SimulationReadiness): Step {
  const base = { id: "limits", title: m.simulation_step_limits(), page: "values" } as const;
  if (missingLimits.length > 0) {
    return {
      ...base,
      status: "blocks",
      description: m.simulations_missing_limits({
        tests: formatList(missingLimits.map((test) => test.name)),
      }),
    };
  }
  if (values.count === 0) {
    return { ...base, status: "todo", description: m.simulation_step_limits_waiting() };
  }
  return { ...base, status: "done", description: m.simulation_step_limits_done() };
}

/** The refusals of the start that a step above the start already shows. */
const STEP_REASONS: ReadonlySet<string> = new Set([
  "no_students",
  "no_correct_values",
  "missing_limits",
]);

function startStep({ startRefusal }: SimulationReadiness): Step {
  const base = { id: "start", title: m.simulation_step_start(), page: null } as const;
  if (startRefusal === null) {
    return { ...base, status: "todo", description: m.simulation_step_start_ready() };
  }
  // A reason of a step above points there; any other shows as the start words it (#386 adds one).
  const fromAbove = STEP_REASONS.has(startRefusal.error);
  return {
    ...base,
    status: "blocks",
    description: fromAbove
      ? m.simulation_step_start_blocked()
      : simulationErrorMessage(startRefusal.error),
  };
}

/** Returns the checklist of a prepared simulation, in the order a teacher works. */
export function stepsOf(readiness: SimulationReadiness): Step[] {
  return [labsStep(readiness), valuesStep(readiness), limitsStep(readiness), startStep(readiness)];
}

/**
 * Returns the step a blocked Start sends focus to: the first step before the start that blocks
 * it, or the start step itself when the reason is none of theirs (a reason #386 adds).
 */
export function firstBlockingStep(readiness: SimulationReadiness): Step["id"] {
  const steps = stepsOf(readiness);
  return steps.find((step) => step.status === "blocks" && step.id !== "start")?.id ?? "start";
}
