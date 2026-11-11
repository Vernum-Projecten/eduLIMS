// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { formOptions, useStore } from "@tanstack/react-form";
import { useServerFn } from "@tanstack/react-start";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { DEMO_RUBRIC } from "@/components/dev-forms/demo-data";
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
import { checkDemoRubricTitle, submitDemoRubric } from "@/server/dev-forms/functions";
import {
  DEMO_NAME_MAX,
  DEMO_POINTS_MAX,
  DEMO_TITLE_MAX,
  demoRubricSchema,
} from "@/server/dev-forms/schemas";

// NOTE: no requirement governs this: our own design, long enough to finish a word.
const TITLE_CHECK_DEBOUNCE_MS = 400;

const rubricForm = formOptions({
  defaultValues: DEMO_RUBRIC,
  validators: { onChange: demoRubricSchema },
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

/** One level of a criterion: its name, its points and its row controls. */
const LevelRow = withForm({
  ...rubricForm,
  props: { ...rowDefaults, criterion: 0 },
  render: function LevelRowRender({ form, criterion, index, count, rowKey, onMove, onRemove }) {
    const label = useStore(
      form.store,
      (state) => state.values.criteria[criterion]?.levels[index]?.label ?? "",
    );
    const position = String(index + 1);
    const item = label.trim() || m.dev_forms_level_position({ position });
    return (
      <div className="flex flex-wrap items-start gap-3">
        <form.AppField name={`criteria[${criterion}].levels[${index}].label`}>
          {(field) => (
            <field.TextField
              id={`${rowKey}-label`}
              label={m.dev_forms_level_label_label({ position })}
              maxLength={DEMO_NAME_MAX}
              className="min-w-0 flex-1 basis-48"
            />
          )}
        </form.AppField>
        <form.AppField name={`criteria[${criterion}].levels[${index}].points`}>
          {(field) => (
            <field.NumberField
              label={m.dev_forms_level_points_label({ position })}
              min={0}
              max={DEMO_POINTS_MAX}
              step={1}
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

/** One criterion: its name, its levels (a nested array) and its row controls. */
const CriterionEditor = withForm({
  ...rubricForm,
  props: rowDefaults,
  render: function CriterionEditorRender({
    form,
    index,
    count,
    rowKey,
    onMove,
    onRemove,
    announce,
    focus,
  }) {
    const name = useStore(form.store, (state) => state.values.criteria[index]?.name ?? "");
    const position = String(index + 1);
    const item = name.trim() || m.dev_forms_criterion_position({ position });
    return (
      <FieldSet className="gap-4 rounded-lg border p-4">
        <FieldLegend>{m.dev_forms_criterion_legend({ position })}</FieldLegend>
        <div className="flex flex-wrap items-start gap-3">
          <form.AppField name={`criteria[${index}].name`}>
            {(field) => (
              <field.TextField
                id={`${rowKey}-name`}
                label={m.dev_forms_criterion_name_label()}
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
        <form.AppField name={`criteria[${index}].levels`} mode="array">
          {(levels) => {
            const rows = levels.state.value;
            const levelKey = (id: string) => `${rowKey}-${id}`;
            // The rows above are a snapshot of the last structural change; names are read live.
            const levelName = (j: number) =>
              form.getFieldValue(`criteria[${index}].levels[${j}].label`).trim() ||
              m.dev_forms_level_position({ position: String(j + 1) });
            return (
              <FieldSet className="gap-3">
                <FieldLegend variant="label">{m.dev_forms_levels_legend({ item })}</FieldLegend>
                <levels.FieldErrors />
                <ol className="flex flex-col gap-3">
                  {rows.map((level, j) => (
                    <li key={level.id}>
                      <LevelRow
                        form={form}
                        criterion={index}
                        index={j}
                        count={rows.length}
                        rowKey={levelKey(level.id)}
                        announce={announce}
                        focus={focus}
                        onMove={(to) => {
                          const label = levelName(j);
                          levels.moveValue(j, to);
                          announce(
                            m.form_array_moved({
                              item: label,
                              position: String(to + 1),
                              count: String(rows.length),
                            }),
                          );
                          focus(
                            rowControlId(
                              levelKey(level.id),
                              controlAfterMove(to, rows.length, to < j ? "up" : "down"),
                            ),
                          );
                        }}
                        onRemove={() => {
                          const label = levelName(j);
                          const neighbour = rows[j + 1] ?? rows[j - 1];
                          levels.removeValue(j);
                          announce(m.form_array_removed({ item: label }));
                          focus(
                            neighbour ? `${levelKey(neighbour.id)}-label` : `${rowKey}-add-level`,
                          );
                        }}
                      />
                    </li>
                  ))}
                </ol>
                <div>
                  <Button
                    id={`${rowKey}-add-level`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const id = newRowId();
                      levels.pushValue({ id, label: "", points: Number.NaN });
                      announce(
                        m.form_array_added({
                          item: m.dev_forms_level_position({ position: String(rows.length + 1) }),
                        }),
                      );
                      focus(`${levelKey(id)}-label`);
                    }}
                  >
                    <PlusIcon aria-hidden="true" data-icon="inline-start" />
                    {m.dev_forms_add_level({ item })}
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
 * The rubric editor of the development page (D1, D4: criteria with levels and points): sync Zod
 * validation on change, a debounced async check of the title, a server refusal at the title, and
 * criteria and levels that are added, removed and reordered by keyboard with every change
 * announced.
 */
export function RubricEditor({ headingId }: Readonly<{ headingId: string }>) {
  const check = useServerFn(checkDemoRubricTitle);
  const submit = useServerFn(submitDemoRubric);
  const [accepted, setAccepted] = useState("");
  const editing = useArrayEditing();
  const base = useId();
  const form = useAppForm({
    ...rubricForm,
    onSubmit: async ({ value, formApi }) => {
      setAccepted("");
      const result = await submit({ data: value });
      if (result.ok) {
        setAccepted(m.dev_forms_rubric_accepted());
        return;
      }
      applyServerRefusal(formApi, {
        fields: { title: m.dev_forms_title_taken({ title: value.title.trim() }) },
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
          name="title"
          validators={{
            onChangeAsyncDebounceMs: TITLE_CHECK_DEBOUNCE_MS,
            onChangeAsync: async ({ value, signal }) => {
              const { available } = await check({ data: { title: value }, signal });
              return available ? undefined : m.dev_forms_title_taken({ title: value.trim() });
            },
          }}
        >
          {(field) => (
            <field.TextField
              label={m.dev_forms_title_label()}
              description={m.dev_forms_title_help()}
              maxLength={DEMO_TITLE_MAX}
            />
          )}
        </form.AppField>
        <form.AppField name="criteria" mode="array">
          {(criteria) => {
            const rows = criteria.state.value;
            const rowKey = (id: string) => `${base}${id}`;
            return (
              <FieldSet className="gap-4">
                <FieldLegend>{m.dev_forms_criteria_legend()}</FieldLegend>
                <criteria.FieldErrors />
                <ol className="flex flex-col gap-4">
                  {rows.map((criterion, index) => {
                    const item = () =>
                      form.getFieldValue(`criteria[${index}].name`).trim() ||
                      m.dev_forms_criterion_position({ position: String(index + 1) });
                    return (
                      <li key={criterion.id}>
                        <CriterionEditor
                          form={form}
                          index={index}
                          count={rows.length}
                          rowKey={rowKey(criterion.id)}
                          announce={editing.announce}
                          focus={editing.focus}
                          onMove={(to) => {
                            const moved = item();
                            criteria.moveValue(index, to);
                            editing.moved(rowKey(criterion.id), moved, index, to, rows.length);
                          }}
                          onRemove={() => {
                            const neighbour = rows[index + 1] ?? rows[index - 1];
                            const removed = item();
                            criteria.removeValue(index);
                            editing.announce(m.form_array_removed({ item: removed }));
                            editing.focus(
                              neighbour ? `${rowKey(neighbour.id)}-name` : `${base}add-criterion`,
                            );
                          }}
                        />
                      </li>
                    );
                  })}
                </ol>
                <div>
                  <Button
                    id={`${base}add-criterion`}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const id = newRowId();
                      criteria.pushValue({
                        id,
                        name: "",
                        levels: [{ id: newRowId(), label: "", points: Number.NaN }],
                      });
                      editing.announce(
                        m.form_array_added({
                          item: m.dev_forms_criterion_position({
                            position: String(rows.length + 1),
                          }),
                        }),
                      );
                      editing.focus(`${rowKey(id)}-name`);
                    }}
                  >
                    <PlusIcon aria-hidden="true" data-icon="inline-start" />
                    {m.dev_forms_add_criterion()}
                  </Button>
                </div>
              </FieldSet>
            );
          }}
        </form.AppField>
        <ArrayAnnouncer announcement={editing.announcement} />
        <div className="flex flex-wrap items-center gap-3">
          <form.SubmitButton icon={<CheckIcon aria-hidden="true" data-icon="inline-start" />}>
            {m.dev_forms_rubric_submit()}
          </form.SubmitButton>
          <p role="status" className="text-sm">
            {accepted}
          </p>
        </div>
      </form.AppForm>
    </form>
  );
}
