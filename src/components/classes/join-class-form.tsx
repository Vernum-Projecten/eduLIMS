// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogInIcon } from "lucide-react";
import { toast } from "sonner";
import { classLabel } from "@/components/classes/class-name";
import { useAppForm } from "@/components/form/app-form";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { JOIN_CODE_INPUT_MAX } from "@/lib/join-code";
import { joinClassFn } from "@/server/classes/functions";
import { classErrorCode, joinClassMutationOptions } from "@/server/classes/query-options";
import { type JoinForm, joinFormSchema } from "@/server/classes/schemas";

/**
 * "Join a class with a code" on the Student portal's overview (#49): the fallback for a student
 * who signs in with another address than the one the teacher invited. A refusal (a wrong code,
 * too many wrong codes) shows at the field; a join is announced in a toast.
 */
export function JoinClassForm() {
  const queryClient = useQueryClient();
  const join = useMutation(joinClassMutationOptions(queryClient, useServerFn(joinClassFn)));
  const form = useAppForm({
    defaultValues: { code: "" } satisfies JoinForm,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: joinFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const outcome = await join.mutateAsync({ code: value.code });
        const name = classLabel({ name: outcome.className, academicYear: outcome.academicYear });
        toast.success(
          outcome.status === "joined"
            ? m.classes_join_done({ name })
            : m.classes_join_already_member({ name }),
        );
        formApi.reset();
      } catch (error) {
        // Every refusal is about the code the student typed, so it shows at its field, where
        // focus already is (a form-level alert would take focus, and the field's blur clears it).
        applyServerRefusal(formApi, {
          fields: { code: classErrorMessage(classErrorCode(error)) },
        });
      }
    },
  });
  return (
    <section aria-labelledby="join-class" className="flex flex-col gap-4">
      <h2 id="join-class" className="text-lg font-semibold">
        {m.classes_join_student_title()}
      </h2>
      <p className="text-muted-foreground">{m.classes_join_student_description()}</p>
      <form
        noValidate
        aria-labelledby="join-class"
        className="flex max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          // NOTE: #49; the same code may work a minute later (the teacher just turned it on),
          // so the last refusal is cleared first: an unchanged value would otherwise stay blocked.
          applyServerRefusal(form, {});
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.FormErrors />
          <FieldGroup>
            <form.AppField name="code">
              {(field) => (
                <field.TextField
                  label={m.classes_join_field_code()}
                  description={m.classes_join_field_code_help()}
                  maxLength={JOIN_CODE_INPUT_MAX}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </form.AppField>
          </FieldGroup>
          <div>
            <form.SubmitButton icon={<LogInIcon aria-hidden="true" data-icon="inline-start" />}>
              {m.classes_join_submit()}
            </form.SubmitButton>
          </div>
        </form.AppForm>
      </form>
    </section>
  );
}
