// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { NameDialog } from "@/components/simulations/name-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { SIMULATION_NAME_MAX } from "@/lib/simulations";
import { deleteSimulationFn, renameSimulationFn } from "@/server/simulations/functions";
import {
  deleteMutationOptions,
  simulationMutationOptions,
} from "@/server/simulations/query-options";
import { simulationFormSchema } from "@/server/simulations/schemas";

/** The link back to the teacher's list of simulations. */
export function BackToSimulations() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/teacher/simulations">
        <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_back()}
      </Link>
    </Button>
  );
}

/** Opens the dialog that renames a simulation (D10, #381); focus returns to the button. */
export function RenameSimulation({
  simulationId,
  name,
}: Readonly<{ simulationId: string; name: string }>) {
  const [renaming, setRenaming] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const callRename = useServerFn(renameSimulationFn);
  const rename = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callRename,
      simulationActionKeys.renameSimulation(simulationId),
    ),
    { success: (_value, data) => m.simulations_renamed({ name: data.name }), toastErrors: false },
  );
  return (
    <>
      <Button
        ref={renameRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRenaming(true)}
      >
        <PencilIcon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_rename()}
      </Button>
      <NameDialog
        control={{
          open: renaming,
          onOpenChange: setRenaming,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            renameRef.current?.focus();
          },
        }}
        schema={simulationFormSchema}
        initial={name}
        title={m.simulations_rename_title({ name })}
        description={m.simulations_rename_description()}
        label={m.simulations_name()}
        submit={m.simulations_save()}
        maxLength={SIMULATION_NAME_MAX}
        save={async (value) => {
          await rename.mutateAsync({ ...value, simulationId });
          // The breadcrumb and the titles come from the loaders: run them again for the new name.
          await router.invalidate();
        }}
      />
    </>
  );
}

/**
 * Deletes a simulation behind a confirmation (D10). The server refuses a simulation that runs or
 * has a student, and the toast says why; a success lands on the list.
 */
export function DeleteSimulation({
  simulationId,
  name,
}: Readonly<{ simulationId: string; name: string }>) {
  // A deleted simulation's page goes, so a success leaves focus to the list it lands on.
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const callDelete = useServerFn(deleteSimulationFn);
  const keys = simulationActionKeys.deleteSimulation(simulationId);
  const remove = useSimulationAction(
    deleteMutationOptions(queryClient, callDelete, keys.removed, keys.invalidates, () =>
      navigate({ to: "/teacher/simulations" }),
    ),
    {
      success: () => m.simulations_deleted({ name }),
      onDone: confirmation.done,
      onFailed: confirmation.failed,
    },
  );
  return (
    <>
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant="destructive"
        size="sm"
        disabled={remove.isPending}
        onClick={confirmation.show}
      >
        <Trash2Icon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_delete()}
      </Button>
      <ConfirmDialog
        confirmation={confirmation}
        title={m.simulations_delete_title({ name })}
        body={m.simulations_delete_body()}
        confirm={m.simulations_delete_confirm()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ simulationId })}
      />
    </>
  );
}
