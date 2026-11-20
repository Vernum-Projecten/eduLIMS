// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FlaskRoundIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ListTable } from "@/components/simulations/list-table";
import { NameDialog } from "@/components/simulations/name-dialog";
import { SimulationStateBadge } from "@/components/simulations/simulation-state";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { SIMULATION_NAME_MAX } from "@/lib/simulations";
import { createSimulationFn } from "@/server/simulations/functions";
import type { TeacherSimulationRow } from "@/server/simulations/queries";
import { simulationMutationOptions } from "@/server/simulations/query-options";
import { simulationFormSchema } from "@/server/simulations/schemas";

const helper = createDataTableColumnHelper<TeacherSimulationRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.simulations_col_name(),
    cell: ({ row }) => (
      <Link
        to="/teacher/simulations/$simulationId"
        params={{ simulationId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor("state", {
    id: "state",
    header: () => m.simulations_col_state(),
    cell: ({ row }) => <SimulationStateBadge state={row.original.state} />,
  }),
  helper.accessor("labs", {
    id: "labs",
    header: () => m.simulations_col_labs(),
    cell: ({ row }) => formatNumber(row.original.labs),
  }),
  helper.accessor("members", {
    id: "members",
    header: () => m.simulations_col_members(),
    cell: ({ row }) => formatNumber(row.original.members),
  }),
  helper.accessor("teachers", {
    id: "teachers",
    header: () => m.simulations_col_teachers(),
    cell: ({ row }) => formatNumber(row.original.teachers),
  }),
  helper.accessor("createdAt", {
    id: "createdAt",
    header: () => m.simulations_col_created(),
    cell: ({ row }) => (
      <time dateTime={row.original.createdAt} className="whitespace-nowrap">
        {formatDate(row.original.createdAt)}
      </time>
    ),
  }),
]);

/** The teacher's own simulations (D10, D11), each linking to its page. */
export function SimulationsList({
  rows,
  busy,
}: Readonly<{ rows: TeacherSimulationRow[]; busy: boolean }>) {
  return (
    <ListTable
      columns={columns}
      data={rows}
      rowId={(row) => row.id}
      caption={m.simulations_caption()}
      busy={busy}
      empty={<SimulationsEmpty />}
    />
  );
}

function SimulationsEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskRoundIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.simulations_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.simulations_empty_body()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** The button and dialog that create a simulation; the teacher lands on its page (D10). */
export function CreateSimulation() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const call = useServerFn(createSimulationFn);
  const create = useSimulationAction(
    simulationMutationOptions(queryClient, call, simulationActionKeys.createSimulation()),
    { success: (_value, data) => m.simulations_created({ name: data.name }), toastErrors: false },
  );
  return (
    <>
      <Button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_create()}
      </Button>
      <NameDialog
        control={{
          open,
          onOpenChange: setOpen,
          onCloseAutoFocus: (event) => {
            // The page changes after a create; only a cancel returns focus to the button.
            if (create.isSuccess) event.preventDefault();
          },
        }}
        schema={simulationFormSchema}
        initial=""
        title={m.simulations_create_title()}
        description={m.simulations_create_description()}
        label={m.simulations_name()}
        submit={m.simulations_create()}
        maxLength={SIMULATION_NAME_MAX}
        save={async (value) => {
          const { simulationId } = await create.mutateAsync(value);
          await navigate({
            to: "/teacher/simulations/$simulationId",
            params: { simulationId },
          });
        }}
      />
    </>
  );
}
