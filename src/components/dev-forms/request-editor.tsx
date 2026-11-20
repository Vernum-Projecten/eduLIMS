// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { formOptions, useStore } from "@tanstack/react-form";
import { useServerFn } from "@tanstack/react-start";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { DEMO_REQUEST } from "@/components/dev-forms/demo-data";
import { useAppForm, withForm } from "@/components/form/app-form";
import {
  ArrayAnnouncer,
  ArrayRowControls,
  rowControlId,
  useArrayEditing,
} from "@/components/form/array-controls";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { controlAfterMove } from "@/lib/forms/array-move";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { checkDemoSampleNumber, submitDemoRequest } from "@/server/dev-forms/functions";
import {
  DEMO_NAME_MAX,
  DEMO_SAMPLE_NUMBER_MAX,
  DEMO_VALUE_MAX,
  demoRequestSchema,
} from "@/server/dev-forms/schemas";

// NOTE: no requirement governs this: our own design, long enough to finish a sample number.
const SAMPLE_NUMBER_CHECK_DEBOUNCE_MS = 400;

const requestForm = formOptions({
  defaultValues: DEMO_REQUEST,
  validators: { onChange: demoRequestSchema },
});

/** What a row's editor needs from the list it is in. */
interface RowProps {
  index: number;
  count: number;
  rowKey: string;
  onMove: (to: number) => void;
  onRemove: () => void;
  announce: (message: string) => void;
  focus: (id: string) => void;
}

const rowDefaults: RowProps = {
  index: 0,
  count: 0,
  rowKey: "",
  onMove: () => undefined,
  onRemove: () => undefined,
  announce: () => undefined,
  focus: () => undefined,
};

/** Returns a new row id; only called from an event handler, so render stays deterministic. */
function newRowId(): string {
  return crypto.randomUUID();
}

/** One measurement of a test: its name, its value and its row controls. */
const MeasurementRow = withForm({
  ...requestForm,
  props: { ...rowDefaults, test: 0 },
  render: function MeasurementRowRender({ form, test, index, count, rowKey, onMove, onRemove }) {
    const label = useStore(
      form.store,
      (state) => state.values.tests[test]?.measurements[index]?.label ?? "",
    );
    const position = String(index + 1);
    const item = label.trim() || m.dev_forms_run_position({ position });
    return (
      <div className="flex flex-wrap items-start gap-3">
        <form.AppField name={`tests[${test}].measurements[${index}].label`}>
          {(field) => (
            <field.TextField
              id={`${rowKey}-label`}
              label={m.dev_forms_run_label_label({ position })}
              maxLength={DEMO_NAME_MAX}
              className="min-w-0 flex-1 basis-48"
            />
          )}
        </form.AppField>
        <form.AppField name={`tests[${test}].measurements[${index}].value`}>
          {(field) => (
            <field.NumberField
              label={m.dev_forms_run_value_label({ position })}
              min={0}
              max={DEMO_VALUE_MAX}
              step="any"
              className="w-28"
            />
          )}
        </form.AppField>
        <div className="sm:pt-6">
          <ArrayRowControls
            rowKey={rowKey}
            item={item}
            index={index}
            count={count}
            onMove={onMove}
            onRemove={onRemove}
          />
        </div>
      </div>
    );
  },
});

/** One requested test: its name, its measurements (a nested array) and its row controls. */
const TestEditor = withForm({
  ...requestForm,
  props: rowDefaults,
  render: function TestEditorRender({
    form,
    index,
    count,
    rowKey,
    onMove,
    onRemove,
    announce,
    focus,
  }) {
    const name = useStore(form.store, (state) => state.values.tests[index]?.name ?? "");
    const position = String(index + 1);
    const item = name.trim() || m.dev_forms_test_position({ position });
    return (
      <FieldSet className="gap-4 rounded-lg border p-4">
        <FieldLegend>{m.dev_forms_test_legend({ position })}</FieldLegend>
        <div className="flex flex-wrap items-start gap-3">
          <form.AppField name={`tests[${index}].name`}>
            {(field) => (
              <field.TextField
                id={`${rowKey}-name`}
                label={m.dev_forms_test_name_label()}
                maxLength={DEMO_NAME_MAX}
                className="min-w-0 flex-1 basis-56"
              />
            )}
          </form.AppField>
          <div className="sm:pt-6">
            <ArrayRowControls
              rowKey={rowKey}
              item={item}
              index={index}
              count={count}
              onMove={onMove}
              onRemove={onRemove}
            />
          </div>
        </div>
        <form.AppField name={`tests[${index}].measurements`} mode="array">
          {(measurements) => {
            const rows = measurements.state.value;
            const runKey = (id: string) => `${rowKey}-${id}`;
            // The rows above are a snapshot of the last structural change; names are read live.
            const runName = (j: number) =>
              form.getFieldValue(`tests[${index}].measurements[${j}].label`).trim() ||
              m.dev_forms_run_position({ position: String(j + 1) });
            return (
              <FieldSet className="gap-3">
                <FieldLegend variant="label">{m.dev_forms_runs_legend({ item })}</FieldLegend>
                <measurements.FieldErrors />
                <ol className="flex flex-col gap-3">
                  {rows.map((measurement, j) => (
                    <li key={measurement.id}>
                      <MeasurementRow
                        form={form}
                        test={index}
                        index={j}
                        count={rows.length}
                        rowKey={runKey(measurement.id)}
                        announce={announce}
                        focus={focus}
                        onMove={(to) => {
                          const label = runName(j);
                          measurements.moveValue(j, to);
                          announce(
                            m.form_array_moved({
                              item: label,
                              position: String(to + 1),
                              count: String(rows.length),
                            }),
                          );
                          focus(
                            rowControlId(
                              runKey(measurement.id),
                              controlAfterMove(to, rows.length, to < j ? "up" : "down"),
                            ),
                          );
                        }}
                        onRemove={() => {
                          const label = runName(j);
                          const neighbour = rows[j + 1] ?? rows[j - 1];
                          measurements.removeValue(j);
                          announce(m.form_array_removed({ item: label }));
                          focus(neighbour ? `${runKey(neighbour.id)}-label` : `${rowKey}-add-run`);
                        }}
                      />
                    </li>
                  ))}
                </ol>
                <div>
                  <Button
                    id={`${rowKey}-add-run`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const id = newRowId();
                      measurements.pushValue({ id, label: "", value: Number.NaN });
                      announce(
                        m.form_array_added({
                          item: m.dev_forms_run_position({ position: String(rows.length + 1) }),
                        }),
                      );
                      focus(`${runKey(id)}-label`);
                    }}
                  >
                    <PlusIcon aria-hidden="true" data-icon="inline-start" />
                    {m.dev_forms_add_run({ item })}
                  </Button>
                </div>
              </FieldSet>
            );
          }}
        </form.AppField>
      </FieldSet>
    );
  },
});

/**
 * The request editor of the development page (S12, S14: the tests of a request, each measured
 * one or more times): sync Zod validation on change, a debounced async check of the sample
 * number, a server refusal at the sample number, and tests and measurements that are added,
 * removed and reordered by keyboard with every change announced.
 */
export function RequestEditor({ headingId }: Readonly<{ headingId: string }>) {
  const check = useServerFn(checkDemoSampleNumber);
  const submit = useServerFn(submitDemoRequest);
  const [accepted, setAccepted] = useState("");
  const editing = useArrayEditing();
  const base = useId();
  const form = useAppForm({
    ...requestForm,
    onSubmit: async ({ value, formApi }) => {
      setAccepted("");
      const result = await submit({ data: value });
      if (result.ok) {
        setAccepted(m.dev_forms_request_accepted());
        return;
      }
      applyServerRefusal(formApi, {
        fields: {
          sampleNumber: m.dev_forms_sample_number_taken({
            sampleNumber: value.sampleNumber.trim(),
          }),
        },
      });
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
        <form.AppField
          name="sampleNumber"
          validators={{
            onChangeAsyncDebounceMs: SAMPLE_NUMBER_CHECK_DEBOUNCE_MS,
            onChangeAsync: async ({ value, signal }) => {
              const { available } = await check({ data: { sampleNumber: value }, signal });
              return available
                ? undefined
                : m.dev_forms_sample_number_taken({ sampleNumber: value.trim() });
            },
          }}
        >
          {(field) => (
            <field.TextField
              label={m.dev_forms_sample_number_label()}
              description={m.dev_forms_sample_number_help()}
              maxLength={DEMO_SAMPLE_NUMBER_MAX}
            />
          )}
        </form.AppField>
        <form.AppField name="tests" mode="array">
          {(tests) => {
            const rows = tests.state.value;
            const rowKey = (id: string) => `${base}${id}`;
            return (
              <FieldSet className="gap-4">
                <FieldLegend>{m.dev_forms_tests_legend()}</FieldLegend>
                <tests.FieldErrors />
                <ol className="flex flex-col gap-4">
                  {rows.map((test, index) => {
                    const item = () =>
                      form.getFieldValue(`tests[${index}].name`).trim() ||
                      m.dev_forms_test_position({ position: String(index + 1) });
                    return (
                      <li key={test.id}>
                        <TestEditor
                          form={form}
                          index={index}
                          count={rows.length}
                          rowKey={rowKey(test.id)}
                          announce={editing.announce}
                          focus={editing.focus}
                          onMove={(to) => {
                            const moved = item();
                            tests.moveValue(index, to);
                            editing.moved(rowKey(test.id), moved, index, to, rows.length);
                          }}
                          onRemove={() => {
                            const neighbour = rows[index + 1] ?? rows[index - 1];
                            const removed = item();
                            tests.removeValue(index);
                            editing.announce(m.form_array_removed({ item: removed }));
                            editing.focus(
                              neighbour ? `${rowKey(neighbour.id)}-name` : `${base}add-test`,
                            );
                          }}
                        />
                      </li>
                    );
                  })}
                </ol>
                <div>
                  <Button
                    id={`${base}add-test`}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const id = newRowId();
                      tests.pushValue({
                        id,
                        name: "",
                        measurements: [{ id: newRowId(), label: "", value: Number.NaN }],
                      });
                      editing.announce(
                        m.form_array_added({
                          item: m.dev_forms_test_position({
                            position: String(rows.length + 1),
                          }),
                        }),
                      );
                      editing.focus(`${rowKey(id)}-name`);
                    }}
                  >
                    <PlusIcon aria-hidden="true" data-icon="inline-start" />
                    {m.dev_forms_add_test()}
                  </Button>
                </div>
              </FieldSet>
            );
          }}
        </form.AppField>
        <ArrayAnnouncer announcement={editing.announcement} />
        <div className="flex flex-wrap items-center gap-3">
          <form.SubmitButton icon={<CheckIcon aria-hidden="true" data-icon="inline-start" />}>
            {m.dev_forms_request_submit()}
          </form.SubmitButton>
          <p role="status" className="text-sm">
            {accepted}
          </p>
        </div>
      </form.AppForm>
    </form>
  );
}
