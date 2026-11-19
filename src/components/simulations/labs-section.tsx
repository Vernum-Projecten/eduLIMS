// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConicalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog } from "@/components/simulations/confirm-dialog";
import { focusById } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
import { NameDialog } from "@/components/simulations/name-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { LAB_NAME_MAX } from "@/lib/simulations";
import { createLabFn, deleteLabFn, renameLabFn } from "@/server/simulations/functions";
import type { TeacherSimulationPage } from "@/server/simulations/queries";
import {
  deleteMutationOptions,
  simulationMutationOptions,
} from "@/server/simulations/query-options";
import { labFormSchema } from "@/server/simulations/schemas";

/** A lab row with the simulation it belongs to, which its actions need. */
interface LabRow {
  simulationId: string;
  id: string;
  name: string;
  members: number;
  waiting: number;
}

const LABS_HEADING = "labs-heading";

const helper = createDataTableColumnHelper<LabRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.labs_col_name(),
    cell: ({ row }) => (
      <Link
        to="/teacher/simulations/$simulationId/labs/$labId"
        params={{ simulationId: row.original.simulationId, labId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor("members", {
    id: "members",
    header: () => m.labs_col_members(),
    cell: ({ row }) => formatNumber(row.original.members),
  }),
  helper.accessor("waiting", {
    id: "waiting",
    header: () => m.labs_col_waiting(),
    cell: ({ row }) => formatNumber(row.original.waiting),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <LabRowActions lab={row.original} />,
  }),
]);

/** The labs of a simulation (D10): each links to its page; rename and delete from its menu. */
export function LabsSection({
  page,
  busy,
}: Readonly<{ page: TeacherSimulationPage; busy: boolean }>) {
  const rows = useMemo(
    () => page.labs.map((lab) => ({ ...lab, simulationId: page.id })),
    [page.labs, page.id],
  );
  return (
    <section aria-labelledby={LABS_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={LABS_HEADING} tabIndex={-1} className="text-lg font-semibold outline-none">
            {m.labs_heading()}
          </h2>
          <p className="text-muted-foreground">{m.labs_description()}</p>
        </div>
        <CreateLab simulationId={page.id} />
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.id}
        caption={m.labs_caption({ simulation: page.name })}
        busy={busy}
        empty={<LabsEmpty />}
      />
    </section>
  );
}

function LabsEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskConicalIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.labs_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.labs_empty_body()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function CreateLab({ simulationId }: Readonly<{ simulationId: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const call = useServerFn(createLabFn);
  const create = useSimulationAction(
    simulationMutationOptions(queryClient, call, simulationActionKeys.createLab(simulationId)),
    { success: (_value, data) => m.labs_created({ name: data.name }), toastErrors: false },
  );
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        {m.labs_create()}
      </Button>
      <NameDialog
        control={{ open, onOpenChange: setOpen }}
        schema={labFormSchema}
        initial=""
        title={m.labs_create_title()}
        description={m.labs_create_description()}
        label={m.labs_name()}
        submit={m.labs_create()}
        maxLength={LAB_NAME_MAX}
        save={(value) => create.mutateAsync({ ...value, simulationId })}
      />
    </>
  );
}

type OpenDialog = "rename" | "delete" | null;

function LabRowActions({ lab }: Readonly<{ lab: LabRow }>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const actions = useLabActions(
    lab.simulationId,
    lab.id,
    lab.name,
    async () => undefined,
    () => focusById(LABS_HEADING),
  );

  function returnFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  return (
    <>
      <DataTableRowActions
        label={m.data_table_row_actions({ name: lab.name })}
        triggerRef={triggerRef}
      >
        <DropdownMenuItem onSelect={() => setDialog("rename")}>
          <PencilIcon aria-hidden="true" />
          {m.labs_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={actions.remove.isPending}
          onSelect={() => setDialog("delete")}
        >
          <Trash2Icon aria-hidden="true" />
          {m.labs_delete()}
        </DropdownMenuItem>
      </DataTableRowActions>
      <LabDialogs
        lab={lab}
        dialog={dialog}
        setDialog={setDialog}
        returnFocus={returnFocus}
        actions={actions}
      />
    </>
  );
}

/**
 * The rename and delete mutations of one lab. `leave` runs before the deleted lab's entry is
 * dropped: the lab's own page moves to its simulation first.
 */
export function useLabActions(
  simulationId: string,
  labId: string,
  name: string,
  leave: () => Promise<void>,
  afterDelete?: () => void,
) {
  const queryClient = useQueryClient();
  const callRename = useServerFn(renameLabFn);
  const callDelete = useServerFn(deleteLabFn);
  const rename = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callRename,
      simulationActionKeys.renameLab(simulationId),
    ),
    { success: (_value, data) => m.labs_renamed({ name: data.name }), toastErrors: false },
  );
  const keys = simulationActionKeys.deleteLab(simulationId, labId);
  const remove = useSimulationAction(
    deleteMutationOptions(queryClient, callDelete, keys.removed, keys.invalidates, leave),
    { success: () => m.labs_deleted({ name }), onDone: afterDelete },
  );
  return { rename, remove };
}

/** The rename dialog and the delete confirmation of one lab. */
export function LabDialogs({
  lab,
  dialog,
  setDialog,
  returnFocus,
  actions,
  afterRename,
}: Readonly<{
  lab: { id: string; name: string };
  dialog: OpenDialog;
  setDialog: (dialog: OpenDialog) => void;
  returnFocus: (event: Event) => void;
  actions: ReturnType<typeof useLabActions>;
  afterRename?: () => Promise<void>;
}>) {
  return (
    <>
      <NameDialog
        control={{
          open: dialog === "rename",
          onOpenChange: (open) => setDialog(open ? "rename" : null),
          onCloseAutoFocus: returnFocus,
        }}
        schema={labFormSchema}
        initial={lab.name}
        title={m.labs_rename_title({ name: lab.name })}
        description={m.labs_rename_description()}
        label={m.labs_name()}
        submit={m.simulations_save()}
        maxLength={LAB_NAME_MAX}
        save={async (value) => {
          await actions.rename.mutateAsync({ ...value, labId: lab.id });
          await afterRename?.();
        }}
      />
      <ConfirmDialog
        control={{
          open: dialog === "delete",
          onOpenChange: (open) => setDialog(open ? "delete" : null),
          onCloseAutoFocus: returnFocus,
        }}
        title={m.labs_delete_title({ name: lab.name })}
        body={m.labs_delete_body()}
        confirm={m.labs_delete_confirm()}
        onConfirm={() => actions.remove.mutate({ labId: lab.id })}
      />
    </>
  );
}
