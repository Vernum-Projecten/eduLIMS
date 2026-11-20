// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, FlaskConicalIcon, SearchXIcon } from "lucide-react";
import { useId } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { StatusPage } from "@/components/shell/route-error";
import { ListTable } from "@/components/simulations/list-table";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import type { AdminSimulation } from "@/server/simulations/admin-queries";

type LabRow = AdminSimulation["labs"][number];

const helper = createDataTableColumnHelper<LabRow>();

const labColumns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.admin_simulations_col_lab(),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  helper.accessor("members", {
    id: "members",
    header: () => m.simulations_col_members(),
    cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.members)}</span>,
  }),
]);

/** "Back to simulations" in the Admin portal. */
export function BackToAdminSimulations() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/admin/simulations">
        <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_back()}
      </Link>
    </Button>
  );
}

/** The teachers of a simulation by name, read-only (B5). */
export function AdminTeachersSection({ simulation }: Readonly<{ simulation: AdminSimulation }>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.admin_simulations_teachers_heading()}
      </h2>
      {simulation.teachers.length > 0 ? (
        <ul
          aria-label={m.admin_simulations_teachers_caption({ name: simulation.name })}
          className="flex flex-col gap-1"
        >
          {simulation.teachers.map((name, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: B5 sends names only and two teachers may share one; the list is static
            <li key={`${index}-${name}`}>{name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{m.admin_simulations_teachers_empty()}</p>
      )}
    </section>
  );
}

/** The labs of a simulation with their number of students, read-only (B5). */
export function AdminLabsSection({
  simulation,
  busy,
}: Readonly<{ simulation: AdminSimulation; busy: boolean }>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.admin_simulations_labs_heading()}
      </h2>
      <ListTable
        columns={labColumns}
        data={simulation.labs}
        rowId={(row) => row.id}
        caption={m.admin_simulations_labs_caption({ name: simulation.name })}
        busy={busy}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConicalIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>{m.admin_simulations_labs_empty()}</h3>
              </EmptyTitle>
              <EmptyDescription>{m.admin_simulations_labs_empty_body()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </section>
  );
}

/** The detail page of a simulation that does not exist (B5). */
export function AdminSimulationNotFound() {
  return (
    <StatusPage
      icon={<SearchXIcon aria-hidden="true" />}
      title={m.simulations_not_found_title()}
      body={<span role="alert">{m.admin_simulations_not_found_body()}</span>}
    >
      <BackToAdminSimulations />
    </StatusPage>
  );
}
