// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConicalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type RefObject, useMemo, useState } from "react";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import {
  type Confirmation,
  ConfirmDialog,
  useConfirmation,
} from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { LabLogo } from "@/components/simulations/lab-logo";
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
import { labLogoSrc } from "@/lib/lab-logo";
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
  logoVersion: string | null;
}

const LABS_HEADING = "labs-heading";

const helper = createDataTableColumnHelper<LabRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.labs_col_name(),
    cell: ({ row }) => {
      const { id, logoVersion } = row.original;
      return (
        <span className="flex items-center gap-3">
          {/* Decorative: the lab's name is the link right beside it. */}
          <LabLogo
            src={logoVersion === null ? null : labLogoSrc(id, logoVersion)}
            alt=""
            size="sm"
          />
          <Link
            to="/teacher/simulations/$simulationId/labs/$labId"
            params={{ simulationId: row.original.simulationId, labId: id }}
            className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        </span>
      );
    },
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
          <h2 id={LABS_HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
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

function LabRowActions({ lab }: Readonly<{ lab: LabRow }>) {
  const [renaming, setRenaming] = useState(false);
  const confirmation = useConfirmation(LABS_HEADING);
  const actions = useLabActions(
    lab.simulationId,
    lab.id,
    lab.name,
    async () => undefined,
    confirmation,
  );

  return (
    <>
      <DataTableRowActions
        label={m.data_table_row_actions({ name: lab.name })}
        triggerRef={confirmation.triggerRef}
      >
        <DropdownMenuItem onSelect={() => setRenaming(true)}>
          <PencilIcon aria-hidden="true" />
          {m.labs_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={actions.remove.isPending}
          onSelect={confirmation.show}
        >
          <Trash2Icon aria-hidden="true" />
          {m.labs_delete()}
        </DropdownMenuItem>
      </DataTableRowActions>
      <LabDialogs
        lab={lab}
        renaming={renaming}
        setRenaming={setRenaming}
        renameFrom={confirmation.triggerRef}
        actions={actions}
        confirmation={confirmation}
      />
    </>
  );
}

/**
 * The rename and delete mutations of one lab. `leave` runs before the deleted lab's entry is
 * dropped: the lab's own page moves to its simulation first. The delete closes `confirmation`
 * with its outcome.
 */
export function useLabActions(
  simulationId: string,
  labId: string,
  name: string,
  leave: () => Promise<void>,
  confirmation: Confirmation,
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
    {
      success: () => m.labs_deleted({ name }),
      onDone: confirmation.done,
      onFailed: confirmation.failed,
    },
  );
  return { rename, remove };
}

/** The rename dialog and the delete confirmation of one lab. */
export function LabDialogs({
  lab,
  renaming,
  setRenaming,
  renameFrom,
  actions,
  confirmation,
  afterRename,
}: Readonly<{
  lab: { id: string; name: string };
  renaming: boolean;
  setRenaming: (open: boolean) => void;
  /** The button focus returns to when the rename dialog closes. */
  renameFrom: RefObject<HTMLButtonElement | null>;
  actions: ReturnType<typeof useLabActions>;
  confirmation: Confirmation;
  afterRename?: () => Promise<void>;
}>) {
  return (
    <>
      <NameDialog
        control={{
          open: renaming,
          onOpenChange: setRenaming,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            renameFrom.current?.focus();
          },
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
        confirmation={confirmation}
        title={m.labs_delete_title({ name: lab.name })}
        body={m.labs_delete_body()}
        confirm={m.labs_delete_confirm()}
        pending={actions.remove.isPending}
        onConfirm={() => actions.remove.mutate({ labId: lab.id })}
      />
    </>
  );
}
