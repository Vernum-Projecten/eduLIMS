// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useId, useMemo } from "react";
import { useAppForm } from "@/components/form/app-form";
import { ArrayAnnouncer, useArrayEditing } from "@/components/form/array-controls";
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
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { formatDate } from "@/lib/i18n/format";
import { requestKindLabel, requestRefusal } from "@/lib/i18n/records-labels";
import { formatLabNumber } from "@/lib/lab-number";
import {
  RECORD_SAMPLE_NUMBER_MAX,
  REMARKS_MAX,
  REQUEST_KINDS,
  REQUESTER_MAX,
  SAMPLE_MATERIAL_MAX,
} from "@/lib/lab-records";
import { correctRequestFn, recordRequestFn } from "@/server/lab-records/functions";
import type { LabRecords, RequestableTest, RequestRow } from "@/server/lab-records/queries";
import { recordsErrorCode } from "@/server/lab-records/query-options";
import { type RequestForm, requestFormSchema } from "@/server/lab-records/schemas";
import { useRecordsAction } from "./use-records-action";

/** Returns a new row key; only called from an event handler or a dialog's first render. */
function newRowKey(): string {
  return crypto.randomUUID();
}

function emptyForm(): RequestForm {
  return {
    kind: "patient",
    patientId: "",
    requester: "",
    phoneThrough: false,
    remarks: "",
    testIds: [],
    samples: [{ key: newRowKey(), sampleNumber: "", material: "" }],
  };
}

function formOf(request: RequestRow): RequestForm {
  return {
    kind: request.kind,
    patientId: request.patientId ?? "",
    requester: request.requester ?? "",
    phoneThrough: request.phoneThrough,
    remarks: request.remarks ?? "",
    testIds: request.tests.map((test) => test.id),
    samples: request.samples.map((sample) => ({
      key: sample.id,
      sampleId: sample.id,
      sampleNumber: sample.sampleNumber,
      material: sample.material,
    })),
  };
}

const KIND_OPTIONS = REQUEST_KINDS.map((kind) => ({ value: kind, label: requestKindLabel(kind) }));

/**
 * Records a request from the form, or corrects one (S12, S16), in a dialog: the kind (a patient
 * or a control sample), the patient, the requester, the requested tests, the phone-through flag,
 * the remarks, and the samples with the sample number and material of the form. The server gives
 * each new sample its lab number and takes the time of entry. A correction keeps the kind and the
 * patient, and adds samples without removing one. Every change to the samples is announced
 * (WCAG 4.1.3), and a refusal shows at the top of the form (WCAG 3.3.1).
 */
export function RequestDialog({
  control,
  records,
  tests,
  request,
}: Readonly<{
  control: DialogControl;
  records: LabRecords;
  tests: readonly RequestableTest[];
  request?: RequestRow | undefined;
}>) {
  const base = useId();
  const labId = records.labId;
  const editing = useArrayEditing();
  const record = useRecordsAction(recordRequestFn, labId, (value) =>
    value.samples.length === 1
      ? m.records_request_recorded_one()
      : m.records_request_recorded_other({ count: String(value.samples.length) }),
  );
  const correct = useRecordsAction(correctRequestFn, labId, (outcome) =>
    outcome.changed === 0 ? m.records_nothing_changed() : m.records_request_corrected(),
  );
  const patientOptions = useMemo(
    () =>
      records.patients.map((patient) => ({
        value: patient.id,
        label: m.records_patient_option({
          name: patient.name,
          identifier: patient.identifier,
          birth: formatDate(patient.dateOfBirth),
        }),
      })),
    [records.patients],
  );
  const testOptions = useMemo(() => {
    const named = request?.tests ?? [];
    const all = [...tests, ...named.filter((t) => !tests.some((test) => test.id === t.id))];
    return all.map((test) => ({
      value: test.id,
      label: test.unit ? m.records_test_option({ test: test.name, unit: test.unit }) : test.name,
    }));
  }, [tests, request]);
  const initial = useMemo(() => (request ? formOf(request) : emptyForm()), [request]);
  const labNumbers = new Map<string, string>(
    request?.samples.map((sample) => [sample.id, sample.labNumber]),
  );

  const form = useAppForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: requestFormSchema },
    onSubmit: async ({ value, formApi }) => {
      // The server function validates the typed values again with its own schema.
      const samples = value.samples.map(({ sampleNumber, material, sampleId }) => ({
        sampleNumber,
        material,
        ...(sampleId ? { sampleId } : {}),
      }));
      const fields = {
        labId,
        requester: value.requester,
        phoneThrough: value.phoneThrough,
        remarks: value.remarks,
        testIds: value.testIds,
      };
      try {
        if (request) {
          await correct.mutateAsync({ ...fields, requestId: request.id, samples });
        } else if (value.kind === "patient") {
          await record.mutateAsync({
            ...fields,
            kind: "patient",
            patientId: value.patientId,
            samples,
          });
        } else {
          await record.mutateAsync({ ...fields, kind: "control", samples });
        }
      } catch (error) {
        applyServerRefusal(formApi, requestRefusal(recordsErrorCode(error)));
        return;
      }
      formApi.reset(emptyForm());
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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
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
                {request ? m.records_request_correct_title() : m.records_request_record_title()}
              </DialogTitle>
              <DialogDescription>
                {request ? m.records_request_correct_body() : m.records_request_record_body()}
              </DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              {request ? null : (
                <form.AppField name="kind">
                  {(field) => (
                    <field.RadioGroupField
                      label={m.records_request_kind()}
                      options={KIND_OPTIONS}
                    />
                  )}
                </form.AppField>
              )}
              <form.Subscribe selector={(state) => state.values.kind}>
                {(kind) =>
                  kind === "patient" ? (
                    <form.AppField name="patientId">
                      {(field) => (
                        <field.SelectField
                          label={m.records_request_patient()}
                          placeholder={m.records_request_patient_placeholder()}
                          options={patientOptions}
                          readOnly={request !== undefined}
                          {...(request ? { description: m.records_request_patient_fixed() } : {})}
                        />
                      )}
                    </form.AppField>
                  ) : null
                }
              </form.Subscribe>
              <form.AppField name="requester">
                {(field) => (
                  <field.TextField
                    label={m.records_requester()}
                    description={m.records_requester_help()}
                    maxLength={REQUESTER_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="testIds">
                {(field) => (
                  <field.CheckboxGroupField label={m.records_tests()} options={testOptions} />
                )}
              </form.AppField>
              <form.AppField name="phoneThrough">
                {(field) => (
                  <field.CheckboxField
                    label={m.records_phone_through()}
                    description={m.records_phone_through_help()}
                  />
                )}
              </form.AppField>
              <form.AppField name="remarks">
                {(field) => (
                  <field.TextareaField
                    label={m.records_remarks()}
                    maxLength={REMARKS_MAX}
                    rows={3}
                  />
                )}
              </form.AppField>
              <form.AppField name="samples" mode="array">
                {(samples) => {
                  const rows = samples.state.value;
                  return (
                    <FieldSet className="gap-3">
                      <FieldLegend variant="label">{m.records_samples()}</FieldLegend>
                      <samples.FieldErrors />
                      <ol className="flex flex-col gap-3">
                        {rows.map((row, index) => {
                          const position = String(index + 1);
                          const item = m.records_sample_position({ position });
                          const labNumber = row.sampleId ? labNumbers.get(row.sampleId) : undefined;
                          return (
                            <li key={row.key}>
                              <FieldSet className="gap-2 rounded-lg border p-3">
                                <FieldLegend variant="label" className="mb-0">
                                  {item}
                                </FieldLegend>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  {labNumber ? (
                                    <span className="text-sm">
                                      {m.records_lab_number()}{" "}
                                      <span className="font-mono tabular-nums">
                                        {formatLabNumber(labNumber)}
                                      </span>
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon-sm"
                                      aria-label={m.form_array_remove({ item })}
                                      disabled={rows.length === 1}
                                      onClick={() => {
                                        const neighbour = rows[index + 1] ?? rows[index - 1];
                                        samples.removeValue(index);
                                        editing.announce(m.form_array_removed({ item }));
                                        editing.focus(
                                          neighbour
                                            ? `${base}${neighbour.key}-number`
                                            : `${base}add-sample`,
                                        );
                                      }}
                                    >
                                      <Trash2Icon aria-hidden="true" />
                                    </Button>
                                  )}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <form.AppField name={`samples[${index}].sampleNumber`}>
                                    {(field) => (
                                      <field.TextField
                                        id={`${base}${row.key}-number`}
                                        label={m.records_sample_number()}
                                        maxLength={RECORD_SAMPLE_NUMBER_MAX}
                                        autoComplete="off"
                                        spellCheck={false}
                                      />
                                    )}
                                  </form.AppField>
                                  <form.AppField name={`samples[${index}].material`}>
                                    {(field) => (
                                      <field.TextField
                                        label={m.records_sample_material()}
                                        maxLength={SAMPLE_MATERIAL_MAX}
                                        autoComplete="off"
                                      />
                                    )}
                                  </form.AppField>
                                </div>
                              </FieldSet>
                            </li>
                          );
                        })}
                      </ol>
                      <div>
                        <Button
                          id={`${base}add-sample`}
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const key = newRowKey();
                            samples.pushValue({ key, sampleNumber: "", material: "" });
                            editing.announce(
                              m.form_array_added({
                                item: m.records_sample_position({
                                  position: String(rows.length + 1),
                                }),
                              }),
                            );
                            editing.focus(`${base}${key}-number`);
                          }}
                        >
                          <PlusIcon aria-hidden="true" data-icon="inline-start" />
                          {m.records_sample_add()}
                        </Button>
                      </div>
                      <ArrayAnnouncer announcement={editing.announcement} />
                    </FieldSet>
                  );
                }}
              </form.AppField>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.simulations_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
                {request ? m.records_save_correction() : m.records_request_record()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
