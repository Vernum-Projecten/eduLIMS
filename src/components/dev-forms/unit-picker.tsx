// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useMemo } from "react";
import { z } from "zod";
import { useAppForm } from "@/components/form/app-form";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { unitOptions } from "@/lib/i18n/unit-labels";

const schema = z.object({
  unit: z.string().refine((value) => value !== "", { error: () => m.catalogue_unit_required() }),
  fixed: z.string(),
});

/**
 * The searchable `ComboboxField` on the UCUM units (#404): one field to choose in, with "No unit"
 * as a choice of its own, and one read-only. Nothing is sent anywhere.
 */
export function UnitPicker({ headingId }: Readonly<{ headingId: string }>) {
  const units = useMemo(() => unitOptions(), []);
  const form = useAppForm({
    defaultValues: { unit: "", fixed: "mg/L" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
  });
  return (
    <form
      noValidate
      aria-labelledby={headingId}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <FieldGroup>
          <form.AppField name="unit">
            {(field) => (
              <field.ComboboxField
                label={m.catalogue_unit()}
                description={m.catalogue_unit_help()}
                placeholder={m.catalogue_unit_placeholder()}
                emptyText={m.catalogue_unit_empty()}
                options={units}
              />
            )}
          </form.AppField>
          <form.AppField name="fixed">
            {(field) => (
              <field.ComboboxField
                label={m.dev_forms_unit_fixed()}
                description={m.catalogue_unit_analyte_fixed_help()}
                placeholder={m.catalogue_unit_placeholder()}
                emptyText={m.catalogue_unit_empty()}
                options={units}
                readOnly
              />
            )}
          </form.AppField>
        </FieldGroup>
        <form.SubmitButton>{m.dev_forms_unit_check()}</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
