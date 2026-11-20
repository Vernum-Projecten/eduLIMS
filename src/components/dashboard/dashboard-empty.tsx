// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CirclePauseIcon, LockIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";

const VARIANTS = {
  none: {
    icon: CirclePauseIcon,
    title: () => m.dashboard_none_title(),
    description: () => m.dashboard_none_description(),
  },
  not_taught: {
    icon: LockIcon,
    title: () => m.dashboard_not_taught_title(),
    description: () => m.dashboard_not_taught_description(),
  },
} as const;

/**
 * Why the dashboard shows no board (#386): no simulation runs, or the one that runs is another
 * teacher's. Both teach the next step: the teacher's own simulations.
 */
export function DashboardEmpty({ kind }: Readonly<{ kind: keyof typeof VARIANTS }>) {
  const variant = VARIANTS[kind];
  const Icon = variant.icon;
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{variant.title()}</h2>
        </EmptyTitle>
        <EmptyDescription>{variant.description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/teacher/simulations">
            {m.dashboard_open_simulations()}
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** The board of a running simulation without correct values: where to enter them. */
export function DashboardNoColumns({ simulationId }: Readonly<{ simulationId: string }>) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TableIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{m.dashboard_no_columns_title()}</h2>
        </EmptyTitle>
        <EmptyDescription>{m.dashboard_no_columns_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/teacher/simulations/$simulationId/values" params={{ simulationId }}>
            {m.simulation_open_values()}
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
