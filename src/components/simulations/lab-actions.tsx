// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { useConfirmation } from "@/components/simulations/confirm-dialog";
import { LabDialogs, useLabActions } from "@/components/simulations/labs-section";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";

/** The link back to a simulation's page. */
export function BackToSimulation({
  simulationId,
  name,
}: Readonly<{ simulationId: string; name?: string }>) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/teacher/simulations/$simulationId" params={{ simulationId }}>
        <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
        {name ? m.labs_back({ simulation: name }) : m.labs_back_unnamed()}
      </Link>
    </Button>
  );
}

/** The actions of a lab's page: back to its simulation, rename it, delete it after a confirmation. */
export function LabActions({
  simulation,
  lab,
}: Readonly<{ simulation: { id: string; name: string }; lab: { id: string; name: string } }>) {
  const [renaming, setRenaming] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  // A deleted lab's page goes, so a success leaves focus to the simulation page it lands on.
  const confirmation = useConfirmation();
  const router = useRouter();
  const navigate = useNavigate();
  const actions = useLabActions(
    simulation.id,
    lab.id,
    lab.name,
    () =>
      navigate({
        to: "/teacher/simulations/$simulationId",
        params: { simulationId: simulation.id },
      }),
    confirmation,
  );
  return (
    <>
      <BackToSimulation simulationId={simulation.id} name={simulation.name} />
      <Button
        ref={renameRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRenaming(true)}
      >
        <PencilIcon aria-hidden="true" data-icon="inline-start" />
        {m.labs_rename()}
      </Button>
      <Button
        ref={confirmation.triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={actions.remove.isPending}
        onClick={confirmation.show}
      >
        <Trash2Icon aria-hidden="true" data-icon="inline-start" />
        {m.labs_delete()}
      </Button>
      <LabDialogs
        lab={lab}
        renaming={renaming}
        setRenaming={setRenaming}
        renameFrom={renameRef}
        actions={actions}
        confirmation={confirmation}
        afterRename={() => router.invalidate()}
      />
    </>
  );
}
