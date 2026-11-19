// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogInIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import { JOIN_CODE_INPUT_MAX } from "@/lib/join-code";
import { joinLabFn } from "@/server/simulations/functions";
import type { JoinOutcome } from "@/server/simulations/join";
import { simulationErrorCode, simulationMutationOptions } from "@/server/simulations/query-options";
import { type JoinForm, joinFormSchema } from "@/server/simulations/schemas";

const HEADING = "join-lab-heading";

function joinedMessage(outcome: JoinOutcome): string {
  const names = { lab: outcome.labName, simulation: outcome.simulationName };
  return outcome.status === "joined" ? m.labs_join_done(names) : m.labs_join_already(names);
}

/**
 * "Join a lab with a code" on the Student portal overview (S10): the way in for a student whose
 * address is on no lab's list. Every refusal is about the code typed, so it shows at the field
 * (WCAG 3.3.1); a join is announced in a toast, a live region (WCAG 4.1.3), and the student's
 * labs are read again.
 */
export function JoinLabForm() {
  const queryClient = useQueryClient();
  const call = useServerFn(joinLabFn);
  const join = useSimulationAction(
    simulationMutationOptions(queryClient, call, simulationActionKeys.joinLab()),
    { success: joinedMessage, toastErrors: false },
  );
  const empty: JoinForm = { code: "" };
  const form = useAppForm({
    defaultValues: empty,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: joinFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await join.mutateAsync({ code: value.code });
        formApi.reset(empty);
      } catch (error) {
        const code = simulationErrorCode(error);
        // A refusal is about the code typed; a failure (the network, a 500) is not, so it goes on
        // top of the form (WCAG 3.3.1).
        applyServerRefusal(
          formApi,
          code === null
            ? { form: m.labs_join_failed() }
            : { fields: { code: simulationErrorMessage(code) } },
        );
      }
    },
  });
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} className="text-lg font-semibold">
          {m.labs_join_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_join_description()}</p>
      </div>
      <form
        noValidate
        aria-labelledby={HEADING}
        className="flex w-full max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.FormErrors />
          <FieldGroup>
            <form.AppField name="code">
              {(field) => (
                <field.TextField
                  label={m.labs_join_field()}
                  description={m.labs_join_field_help()}
                  maxLength={JOIN_CODE_INPUT_MAX}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </form.AppField>
          </FieldGroup>
          <div>
            <form.SubmitButton icon={<LogInIcon aria-hidden="true" data-icon="inline-start" />}>
              {m.labs_join_submit()}
            </form.SubmitButton>
          </div>
        </form.AppForm>
      </form>
    </section>
  );
}
