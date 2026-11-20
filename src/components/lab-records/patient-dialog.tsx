// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { SaveIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import type { DialogControl } from "@/components/simulations/name-dialog";
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
import { sexLabel } from "@/lib/i18n/records-labels";
import { PATIENT_IDENTIFIER_MAX, PATIENT_NAME_MAX, PATIENT_SEXES } from "@/lib/lab-records";
import { correctPatientFn, registerPatientFn } from "@/server/lab-records/functions";
import type { PatientRow } from "@/server/lab-records/queries";
import { type PatientDetailsForm, patientDetailsSchema } from "@/server/lab-records/schemas";
import { recordsRefusal, useRecordsAction } from "./use-records-action";

const EMPTY: PatientDetailsForm = { name: "", dateOfBirth: "", sex: "", identifier: "" };

const SEX_OPTIONS = PATIENT_SEXES.map((sex) => ({ value: sex, label: sexLabel(sex) }));

/**
 * Registers a patient from the form, or corrects one (S11), in a dialog. The fields hold what
 * the team types and nothing else: eduLIMS fills in and corrects nothing. A refusal shows at the
 * top of the form (WCAG 3.3.1); a saved patient is announced in a toast (WCAG 4.1.3).
 */
export function PatientDialog({
  control,
  labId,
  patient,
}: Readonly<{ control: DialogControl; labId: string; patient?: PatientRow | undefined }>) {
  const register = useRecordsAction(registerPatientFn, labId, () => m.records_patient_registered());
  const correct = useRecordsAction(correctPatientFn, labId, (outcome) =>
    outcome.changed === 0 ? m.records_nothing_changed() : m.records_patient_corrected(),
  );
  const initial: PatientDetailsForm = patient
    ? {
        name: patient.name,
        dateOfBirth: patient.dateOfBirth,
        sex: patient.sex,
        identifier: patient.identifier,
      }
    : EMPTY;
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: patientDetailsSchema },
    onSubmit: async ({ value, formApi }) => {
      const details = patientDetailsSchema.parse(value);
      try {
        if (patient) {
          await correct.mutateAsync({ ...details, labId, patientId: patient.id });
        } else {
          await register.mutateAsync({ ...details, labId });
        }
      } catch (error) {
        applyServerRefusal(formApi, { form: recordsRefusal(error) });
        return;
      }
      formApi.reset(EMPTY);
      control.onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) form.reset(initial);
        control.onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
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
              <DialogTitle>
                {patient ? m.records_patient_correct_title() : m.records_patient_register_title()}
              </DialogTitle>
              <DialogDescription>
                {patient ? m.records_patient_correct_body() : m.records_patient_register_body()}
              </DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label={m.records_patient_name()}
                    maxLength={PATIENT_NAME_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="dateOfBirth">
                {(field) => (
                  <field.TextField
                    label={m.records_patient_birth()}
                    description={m.records_patient_birth_help()}
                    autoComplete="off"
                    inputMode="numeric"
                  />
                )}
              </form.AppField>
              <form.AppField name="sex">
                {(field) => (
                  <field.RadioGroupField label={m.records_patient_sex()} options={SEX_OPTIONS} />
                )}
              </form.AppField>
              <form.AppField name="identifier">
                {(field) => (
                  <field.TextField
                    label={m.records_patient_identifier()}
                    maxLength={PATIENT_IDENTIFIER_MAX}
                    autoComplete="off"
                    spellCheck={false}
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
              <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
                {patient ? m.records_save_correction() : m.records_patient_register()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
