// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { m } from "@/i18n/messages";
import { parseEmailList } from "@/lib/forms/email-list";

/**
 * An email list for a `string[]` value: paste or type many addresses (one per line, or separated
 * by commas or semicolons) and they become entries on paste, on Enter and when the field loses
 * focus. Each entry has a remove button; the list is announced with its count. Validate it with
 * `emailListSchema`, whose messages name the address they refuse.
 */
export function EmailListField({ label, description, className, id }: BaseFieldProps) {
  const field = useFieldContext<string[]>();
  const a11y = useFieldA11y(field, description, id);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const listId = `${useId()}list`;
  const addresses = field.state.value;

  function commit(text: string) {
    const added = parseEmailList(text, addresses);
    setDraft("");
    if (added.length === 0) return;
    field.handleChange([...addresses, ...added]);
    setAnnouncement(m.form_email_list_added_count({ count: String(added.length) }));
  }

  function remove(address: string) {
    field.handleChange(addresses.filter((held) => held !== address));
    setAnnouncement(m.form_email_list_removed({ address }));
    document.getElementById(a11y.controlId)?.focus();
  }

  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Textarea
        {...a11y.controlProps}
        value={draft}
        rows={3}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          e.preventDefault();
          commit(`${draft} ${e.clipboardData.getData("text")}`);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => {
          commit(draft);
          field.handleBlur();
        }}
      />
      <FieldFeedback a11y={a11y} description={description} />
      {addresses.length > 0 && (
        <ul
          id={listId}
          aria-label={m.form_email_list_entries({ count: String(addresses.length) })}
          className="flex flex-wrap gap-2"
        >
          {addresses.map((address) => (
            <li key={address}>
              <Badge variant="secondary" className="h-7 gap-1 pr-0.5 text-sm font-normal">
                <span className="break-all">{address}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={m.form_email_list_remove({ address })}
                  onClick={() => remove(address)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </Field>
  );
}
