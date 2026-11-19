// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
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
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // The dialog is already closed when focus returns, so the button it came from is kept here.
  const openedFrom = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  const navigate = useNavigate();
  const actions = useLabActions(simulation.id, lab.id, lab.name, () =>
    navigate({ to: "/teacher/simulations/$simulationId", params: { simulationId: simulation.id } }),
  );
  return (
    <>
      <BackToSimulation simulationId={simulation.id} name={simulation.name} />
      <Button
        ref={renameRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          openedFrom.current = renameRef.current;
          setDialog("rename");
        }}
      >
        <PencilIcon aria-hidden="true" data-icon="inline-start" />
        {m.labs_rename()}
      </Button>
      <Button
        ref={deleteRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={actions.remove.isPending}
        onClick={() => {
          openedFrom.current = deleteRef.current;
          setDialog("delete");
        }}
      >
        <Trash2Icon aria-hidden="true" data-icon="inline-start" />
        {m.labs_delete()}
      </Button>
      <LabDialogs
        lab={lab}
        dialog={dialog}
        setDialog={setDialog}
        returnFocus={(event) => {
          event.preventDefault();
          openedFrom.current?.focus();
        }}
        actions={actions}
        afterRename={() => router.invalidate()}
      />
    </>
  );
}
