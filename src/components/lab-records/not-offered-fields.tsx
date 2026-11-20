// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { formOptions, revalidateLogic } from "@tanstack/react-form";
import { PlusIcon } from "lucide-react";
import { withForm } from "@/components/form/app-form";
import {
  ArrayAnnouncer,
  ArrayRowControls,
  useArrayEditing,
} from "@/components/form/array-controls";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { NOT_OFFERED_NAME_MAX, NOT_OFFERED_REMARK_MAX } from "@/lib/lab-records";
import { type RequestForm, requestFormSchema } from "@/server/lab-records/schemas";

const TYPE_ONLY: RequestForm = {
  kind: "patient",
  patientId: "",
  requester: "",
  phoneThrough: false,
  remarks: "",
  testIds: [],
  notOffered: [],
  samples: [],
};

/** The options the request dialog and its parts share, so the parts are typed by the form. */
export const requestFormOptions = formOptions({
  defaultValues: TYPE_ONLY,
  validationLogic: revalidateLogic(),
  validators: { onDynamic: requestFormSchema },
});

/** Returns a new row key; only called from an event handler or a dialog's first render. */
export function newRowKey(): string {
  return crypto.randomUUID();
}

/**
 * The tests the form asks for that the lab does not offer (S12, #398): each a free-text name as
 * written on the form and an optional remark. Nothing here checks an entry or suggests one
 * (Q-SIM-1); every change to the list is announced and keeps the focus in place (WCAG 4.1.3,
 * 2.4.3).
 */
export const NotOfferedFields = withForm({
  ...requestFormOptions,
  props: { idBase: "" },
  render: function Render({ form, idBase }) {
    const editing = useArrayEditing();
    const nameId = (key: string) => `${idBase}${key}-not-offered-name`;
    const addId = `${idBase}add-not-offered`;
    return (
      <form.AppField name="notOffered" mode="array">
        {(list) => {
          const rows = list.state.value;
          return (
            <FieldSet className="gap-3">
              <FieldLegend variant="label">{m.records_not_offered()}</FieldLegend>
              <FieldDescription>{m.records_not_offered_help()}</FieldDescription>
              <list.FieldErrors />
              {rows.length === 0 ? null : (
                <ol className="flex flex-col gap-3">
                  {rows.map((row, index) => {
                    const item = m.records_not_offered_position({ position: String(index + 1) });
                    const rowKey = `${idBase}${row.key}`;
                    return (
                      <li key={row.key}>
                        <FieldSet className="gap-2 rounded-lg border p-3">
                          {/* The legend is the fieldset's first child, so it names the group. */}
                          <FieldLegend variant="label" className="mb-0">
                            {item}
                          </FieldLegend>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <ArrayRowControls
                              rowKey={rowKey}
                              item={item}
                              index={index}
                              count={rows.length}
                              onMove={(to) => {
                                list.moveValue(index, to);
                                editing.moved(rowKey, item, index, to, rows.length);
                              }}
                              onRemove={() => {
                                const neighbour = rows[index + 1] ?? rows[index - 1];
                                list.removeValue(index);
                                editing.announce(m.form_array_removed({ item }));
                                editing.focus(neighbour ? nameId(neighbour.key) : addId);
                              }}
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <form.AppField name={`notOffered[${index}].name`}>
                              {(field) => (
                                <field.TextField
                                  id={nameId(row.key)}
                                  label={m.records_not_offered_name()}
                                  maxLength={NOT_OFFERED_NAME_MAX}
                                  autoComplete="off"
                                />
                              )}
                            </form.AppField>
                            <form.AppField name={`notOffered[${index}].remark`}>
                              {(field) => (
                                <field.TextField
                                  label={m.records_not_offered_remark()}
                                  maxLength={NOT_OFFERED_REMARK_MAX}
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
              )}
              <div>
                <Button
                  id={addId}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const key = newRowKey();
                    list.pushValue({ key, name: "", remark: "" });
                    editing.announce(
                      m.form_array_added({
                        item: m.records_not_offered_position({
                          position: String(rows.length + 1),
                        }),
                      }),
                    );
                    editing.focus(nameId(key));
                  }}
                >
                  <PlusIcon aria-hidden="true" data-icon="inline-start" />
                  {m.records_not_offered_add()}
                </Button>
              </div>
              <ArrayAnnouncer announcement={editing.announcement} />
            </FieldSet>
          );
        }}
      </form.AppField>
    );
  },
});
