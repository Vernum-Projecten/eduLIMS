// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeftIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import type { DialogControl } from "@/components/simulations/name-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { moveMemberFn } from "@/server/simulations/functions";
import type { TeacherLabPage } from "@/server/simulations/queries";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";
import { type MoveMemberForm, moveMemberFormSchema } from "@/server/simulations/schemas";

/** The student a move concerns, with their lab and the labs they may go to. */
export interface MoveTarget {
  simulationId: string;
  userId: string;
  name: string;
  labName: string;
  otherLabs: TeacherLabPage["otherLabs"];
}

/**
 * The dialog that moves a student to another lab of the same simulation (D10), as a choice of
 * radio buttons, so the keyboard alone does it (WCAG 2.1.1). A refusal shows at the top.
 */
export function MoveDialog({
  member,
  control,
}: Readonly<{ member: MoveTarget; control: DialogControl }>) {
  const queryClient = useQueryClient();
  const callMove = useServerFn(moveMemberFn);
  const move = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callMove,
      simulationActionKeys.moveMember(member.simulationId),
    ),
    {
      success: (_value, data) =>
        m.labs_member_moved({
          name: member.name,
          lab: member.otherLabs.find((lab) => lab.id === data.labId)?.name ?? "",
        }),
      toastErrors: false,
    },
  );
  const initial: MoveMemberForm = { labId: member.otherLabs[0]?.id ?? "" };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: moveMemberFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await move.mutateAsync({
          ...moveMemberFormSchema.parse(value),
          simulationId: member.simulationId,
          userId: member.userId,
        });
      } catch (error) {
        const code = simulationErrorCode(error);
        applyServerRefusal(
          formApi,
          code === "same_lab"
            ? { fields: { labId: simulationErrorMessage(code) } }
            : { form: simulationErrorMessage(code) },
        );
        return;
      }
      control.onOpenChange(false);
    },
  });
  return (
    <Dialog open={control.open} onOpenChange={control.onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <DialogHeader>
              <DialogTitle>{m.labs_member_move_title({ name: member.name })}</DialogTitle>
              <DialogDescription>
                {m.labs_member_move_description({ lab: member.labName })}
              </DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="labId">
                {(field) => (
                  <field.RadioGroupField
                    label={m.labs_member_move_target()}
                    options={member.otherLabs.map((lab) => ({ value: lab.id, label: lab.name }))}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.simulations_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton
                icon={<ArrowRightLeftIcon aria-hidden="true" data-icon="inline-start" />}
              >
                {m.labs_member_move_confirm()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
