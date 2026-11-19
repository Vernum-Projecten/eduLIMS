// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MailIcon, MailXIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog } from "@/components/simulations/confirm-dialog";
import { focusById } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
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
import { formatDate } from "@/lib/i18n/format";
import { removeEmailFn } from "@/server/simulations/functions";
import type { TeacherLabPage } from "@/server/simulations/queries";
import { simulationMutationOptions } from "@/server/simulations/query-options";

const WAITING_HEADING = "waiting-heading";

/** A waiting address with the lab it waits for. */
interface WaitingRow {
  simulationId: string;
  labId: string;
  email: string;
  addedAt: string;
}

const helper = createDataTableColumnHelper<WaitingRow>();

const columns = helper.columns([
  helper.accessor("email", {
    id: "email",
    header: () => m.labs_paste_col_address(),
    cell: ({ row }) => <span className="break-all">{row.original.email}</span>,
  }),
  helper.accessor("addedAt", {
    id: "addedAt",
    header: () => m.labs_col_added(),
    cell: ({ row }) => (
      <time dateTime={row.original.addedAt} className="whitespace-nowrap">
        {formatDate(row.original.addedAt)}
      </time>
    ),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <RemoveWaiting row={row.original} />,
  }),
]);

/**
 * The addresses that wait for a student to sign in (S10): they do not expire, and a teacher
 * removes one behind a confirmation.
 */
export function WaitingSection({ page, busy }: Readonly<{ page: TeacherLabPage; busy: boolean }>) {
  const rows = useMemo(
    () =>
      page.waiting.map((waiting) => ({
        ...waiting,
        simulationId: page.simulation.id,
        labId: page.id,
      })),
    [page.waiting, page.simulation.id, page.id],
  );
  return (
    <section aria-labelledby={WAITING_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={WAITING_HEADING} tabIndex={-1} className="text-lg font-semibold outline-none">
          {m.labs_waiting_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_waiting_description()}</p>
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.email}
        caption={m.labs_waiting_caption({ lab: page.name })}
        busy={busy}
        empty={<WaitingEmpty />}
      />
    </section>
  );
}

function WaitingEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MailIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.labs_waiting_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.labs_waiting_empty_body()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function RemoveWaiting({ row }: Readonly<{ row: WaitingRow }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const call = useServerFn(removeEmailFn);
  const remove = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      call,
      simulationActionKeys.removeEmail(row.simulationId),
    ),
    {
      success: () => m.labs_waiting_removed({ email: row.email }),
      onDone: () => focusById(WAITING_HEADING),
    },
  );
  const label = m.labs_waiting_remove({ email: row.email });
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled={remove.isPending}
        onClick={() => setOpen(true)}
      >
        <MailXIcon aria-hidden="true" />
      </Button>
      <ConfirmDialog
        control={{ open, onOpenChange: setOpen }}
        title={m.labs_waiting_remove_title({ email: row.email })}
        body={m.labs_waiting_remove_body()}
        confirm={m.labs_waiting_remove_confirm()}
        onConfirm={() => remove.mutate({ labId: row.labId, email: row.email })}
      />
    </>
  );
}
