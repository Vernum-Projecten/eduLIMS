// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useAppForm } from "@/components/form/app-form";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatNumber } from "@/lib/i18n/format";
import { simulationErrorMessage } from "@/lib/i18n/simulation-labels";
import {
  JOIN_CODE_DAYS_DEFAULT,
  JOIN_CODE_DAYS_MAX,
  JOIN_CODE_USES_DEFAULT,
  JOIN_CODE_USES_MAX,
} from "@/lib/join-code";
import { simulationErrorCode } from "@/server/simulations/query-options";
import { type JoinCodeForm, joinCodeFormSchema } from "@/server/simulations/schemas";

const DEFAULTS: JoinCodeForm = {
  validDays: JOIN_CODE_DAYS_DEFAULT,
  maxUses: JOIN_CODE_USES_DEFAULT,
};

/**
 * The term and the number of joins of a lab code, with the form's submit: shared by turning the
 * code on and making a new one. `save` throws the server's refusal, which shows at the top of the
 * form (WCAG 3.3.1); `footer` places the submit button, in a dialog's footer for instance.
 */
export function JoinCodeSettingsForm({
  label,
  submit,
  save,
  footer,
}: Readonly<{
  label: string;
  submit: string;
  save: (value: JoinCodeForm) => Promise<unknown>;
  footer?: (button: ReactNode) => ReactNode;
}>) {
  const form = useAppForm({
    defaultValues: DEFAULTS,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: joinCodeFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save(joinCodeFormSchema.parse(value));
      } catch (error) {
        applyServerRefusal(formApi, {
          form: simulationErrorMessage(simulationErrorCode(error)),
        });
      }
    },
  });
  const button = (
    <form.SubmitButton icon={<KeyRoundIcon aria-hidden="true" data-icon="inline-start" />}>
      {submit}
    </form.SubmitButton>
  );
  return (
    <form
      noValidate
      aria-label={label}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="validDays">
            {(field) => (
              <field.NumberField
                label={m.labs_code_field_days()}
                description={m.labs_code_field_days_help({
                  max: formatNumber(JOIN_CODE_DAYS_MAX),
                })}
                min={1}
                max={JOIN_CODE_DAYS_MAX}
                step={1}
              />
            )}
          </form.AppField>
          <form.AppField name="maxUses">
            {(field) => (
              <field.NumberField
                label={m.labs_code_field_uses()}
                description={m.labs_code_field_uses_help({
                  max: formatNumber(JOIN_CODE_USES_MAX),
                })}
                min={1}
                max={JOIN_CODE_USES_MAX}
                step={1}
              />
            )}
          </form.AppField>
        </FieldGroup>
        {footer ? footer(button) : <div>{button}</div>}
      </form.AppForm>
    </form>
  );
}
