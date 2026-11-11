// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useServerFn } from "@tanstack/react-start";
import { SendIcon } from "lucide-react";
import { useState } from "react";
import { DEMO_SESSION } from "@/components/dev-forms/demo-data";
import { useAppForm } from "@/components/form/app-form";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { dayIn } from "@/lib/app-day";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { submitDemoSession } from "@/server/dev-forms/functions";
import {
  DEMO_GROUP_MAX,
  DEMO_NAME_MAX,
  DEMO_NOTES_MAX,
  DEMO_OBSERVERS_MAX,
  demoSessionSchema,
} from "@/server/dev-forms/schemas";

const ONE_DAY_MS = 86_400_000;

/**
 * The session form of the development page: one field of every registered kind, validated with
 * the shared schema on submit, and a switch that makes the stub server refuse the whole form so
 * `FormErrors` shows at the top with focus on it.
 */
export function SessionForm({ headingId }: Readonly<{ headingId: string }>) {
  const submit = useServerFn(submitDemoSession);
  const [accepted, setAccepted] = useState("");
  const form = useAppForm({
    defaultValues: DEMO_SESSION,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: demoSessionSchema },
    onSubmit: async ({ value, formApi }) => {
      setAccepted("");
      const result = await submit({ data: value });
      if (result.ok) {
        setAccepted(m.dev_forms_session_accepted());
        return;
      }
      applyServerRefusal(formApi, { form: m.dev_forms_session_refused() });
    },
  });

  return (
    <form
      noValidate
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          <form.AppField name="name">
            {(field) => (
              <field.TextField label={m.dev_forms_session_name_label()} maxLength={DEMO_NAME_MAX} />
            )}
          </form.AppField>
          <form.AppField name="notes">
            {(field) => (
              <field.TextareaField
                label={m.dev_forms_notes_label()}
                description={m.dev_forms_notes_help({ max: String(DEMO_NOTES_MAX) })}
                maxLength={DEMO_NOTES_MAX}
                rows={3}
              />
            )}
          </form.AppField>
          <form.AppField name="groupSize">
            {(field) => (
              <field.NumberField
                label={m.dev_forms_group_size_label()}
                description={m.dev_forms_group_size_help({ max: String(DEMO_GROUP_MAX) })}
                min={1}
                max={DEMO_GROUP_MAX}
                step={1}
                className="sm:w-48"
              />
            )}
          </form.AppField>
          <form.AppField name="analyser">
            {(field) => (
              <field.SelectField
                label={m.dev_forms_analyser_label()}
                placeholder={m.dev_forms_analyser_placeholder()}
                options={[
                  { value: "afinion", label: m.dev_forms_analyser_afinion() },
                  { value: "epoch", label: m.dev_forms_analyser_epoch() },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="part">
            {(field) => (
              <field.RadioGroupField
                label={m.dev_forms_part_label()}
                options={[
                  { value: "morning", label: m.dev_forms_part_morning() },
                  { value: "afternoon", label: m.dev_forms_part_afternoon() },
                  { value: "day", label: m.dev_forms_part_day() },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="measurements">
            {(field) => (
              <field.CheckboxGroupField
                label={m.dev_forms_measurements_label()}
                description={m.dev_forms_measurements_help()}
                options={[
                  { value: "hba1c", label: m.dev_forms_measurement_hba1c() },
                  { value: "crp", label: m.dev_forms_measurement_crp() },
                  { value: "absorbance", label: m.dev_forms_measurement_absorbance() },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="day">
            {(field) => (
              <field.DateField
                label={m.dev_forms_day_label()}
                description={m.dev_forms_day_help()}
                minDay={dayIn(new Date(Date.now() + ONE_DAY_MS))}
                optional={false}
              />
            )}
          </form.AppField>
          <form.AppField name="observers">
            {(field) => (
              <field.EmailListField
                label={m.dev_forms_observers_label()}
                description={m.dev_forms_observers_help({ max: String(DEMO_OBSERVERS_MAX) })}
              />
            )}
          </form.AppField>
          <form.AppField name="reminder">
            {(field) => (
              <field.CheckboxField
                label={m.dev_forms_reminder_label()}
                description={m.dev_forms_reminder_help()}
              />
            )}
          </form.AppField>
          <form.AppField name="simulateRefusal">
            {(field) => (
              <field.SwitchField
                label={m.dev_forms_simulate_label()}
                description={m.dev_forms_simulate_help()}
              />
            )}
          </form.AppField>
        </FieldGroup>
        <div className="flex flex-wrap items-center gap-3">
          <form.SubmitButton icon={<SendIcon aria-hidden="true" data-icon="inline-start" />}>
            {m.dev_forms_session_submit()}
          </form.SubmitButton>
          <p role="status" className="text-sm">
            {accepted}
          </p>
        </div>
      </form.AppForm>
    </form>
  );
}
