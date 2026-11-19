// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog } from "@/components/simulations/confirm-dialog";
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

type OpenDialog = "rename" | "delete" | null;

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

/**
 * The actions of a simulation's page: rename it, and delete it behind a confirmation. The server
 * refuses to delete a simulation that has a student, and the toast says so.
 */
export function SimulationActions({
  simulationId,
  name,
}: Readonly<{ simulationId: string; name: string }>) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const callRename = useServerFn(renameSimulationFn);
  const callDelete = useServerFn(deleteSimulationFn);
  const rename = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callRename,
      simulationActionKeys.renameSimulation(simulationId),
    ),
    { success: (_value, data) => m.simulations_renamed({ name: data.name }), toastErrors: false },
  );
  const keys = simulationActionKeys.deleteSimulation(simulationId);
  const remove = useSimulationAction(
    deleteMutationOptions(queryClient, callDelete, keys.removed, keys.invalidates, () =>
      navigate({ to: "/teacher/simulations" }),
    ),
    { success: () => m.simulations_deleted({ name }) },
  );

  return (
    <>
      <BackToSimulations />
      <Button
        ref={renameRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDialog("rename")}
      >
        <PencilIcon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_rename()}
      </Button>
      <Button
        ref={deleteRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={remove.isPending}
        onClick={() => setDialog("delete")}
      >
        <Trash2Icon aria-hidden="true" data-icon="inline-start" />
        {m.simulations_delete()}
      </Button>
      <NameDialog
        control={{
          open: dialog === "rename",
          onOpenChange: (open) => setDialog(open ? "rename" : null),
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
          // The breadcrumb and the title come from the loader: run it again for the new name.
          await router.invalidate();
        }}
      />
      <ConfirmDialog
        control={{
          open: dialog === "delete",
          onOpenChange: (open) => setDialog(open ? "delete" : null),
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            deleteRef.current?.focus();
          },
        }}
        title={m.simulations_delete_title({ name })}
        body={m.simulations_delete_body()}
        confirm={m.simulations_delete_confirm()}
        onConfirm={() => remove.mutate({ simulationId })}
      />
    </>
  );
}
