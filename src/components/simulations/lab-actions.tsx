// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useNavigate, useRouter } from "@tanstack/react-router";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { RowActions } from "@/components/shell/row-actions";
import { useConfirmation } from "@/components/simulations/confirm-dialog";
import { LabDialogs, useLabActions } from "@/components/simulations/labs-section";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";

/**
 * The secondary actions of a lab's page in its `…` menu (#384): rename it, or delete it after a
 * confirmation and land on the simulation's labs. Both dialogs close back to the menu's button.
 */
export function LabActions({
  simulation,
  lab,
}: Readonly<{ simulation: { id: string; name: string }; lab: { id: string; name: string } }>) {
  const [renaming, setRenaming] = useState(false);
  // A deleted lab's page goes, so a success leaves focus to the labs page it lands on.
  const confirmation = useConfirmation();
  const router = useRouter();
  const navigate = useNavigate();
  const actions = useLabActions(
    simulation.id,
    lab.id,
    lab.name,
    () =>
      navigate({
        to: "/teacher/simulations/$simulationId/labs",
        params: { simulationId: simulation.id },
      }),
    confirmation,
  );
  return (
    <>
      <RowActions
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
      </RowActions>
      <LabDialogs
        lab={lab}
        renaming={renaming}
        setRenaming={setRenaming}
        renameFrom={confirmation.triggerRef}
        actions={actions}
        confirmation={confirmation}
        afterRename={() => router.invalidate()}
      />
    </>
  );
}
