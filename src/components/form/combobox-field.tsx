// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef } from "react";
import type { FieldOption } from "@/components/form/choice-fields";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";

/** A choice of a combobox: an option with extra text a search may match. */
export interface ComboboxOption<T extends string> extends FieldOption<T> {
  /** Words the search matches besides the label, such as a code the label spells differently. */
  readonly keywords?: string;
}

/** Returns whether `option` matches the typed `query`: its label or keywords, ignoring case. */
export function optionMatches<T extends string>(option: ComboboxOption<T>, query: string): boolean {
  const text = `${option.label} ${option.keywords ?? ""}`.toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase());
}

/**
 * A searchable select for one of `options` (the shadcn combobox on Base UI): typing filters the
 * list on each option's label and keywords. `""` is no choice yet; an option the caller adds
 * (such as "No unit") is a choice like any other, so clearing the text never chooses it. The list
 * renders next to the field, inside a dialog when the field is in one, so the dialog's focus trap
 * and its pointer events take it in. With `readOnly` the input stays focusable and announces
 * `aria-readonly`, but no choice changes the value (WCAG 3.3.2).
 */
export function ComboboxField<T extends string>({
  label,
  description,
  className,
  id,
  options,
  placeholder,
  emptyText,
  readOnly = false,
}: BaseFieldProps & {
  readonly options: readonly ComboboxOption<T>[];
  readonly placeholder: string;
  /** Shown when the search matches no option. */
  readonly emptyText: string;
  readonly readOnly?: boolean;
}) {
  const field = useFieldContext<T | "">();
  const a11y = useFieldA11y(field, description, id);
  const listHost = useRef<HTMLDivElement>(null);
  const items = useMemo(() => options.map((option) => option.value), [options]);
  const optionOf = (value: string) => options.find((option) => option.value === value);
  const current = field.state.value;

  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Combobox
        items={items}
        value={current === "" ? null : current}
        readOnly={readOnly}
        itemToStringLabel={(value: string) => optionOf(value)?.label ?? ""}
        filter={(value: string, query: string) => {
          const option = optionOf(value);
          return option !== undefined && optionMatches(option, query);
        }}
        onValueChange={(value: string | null) => {
          if (readOnly) return;
          field.handleChange(value === null ? "" : (optionOf(value)?.value ?? ""));
        }}
        onOpenChange={(open: boolean) => {
          if (!open) field.handleBlur();
        }}
      >
        <ComboboxInput
          id={a11y.controlId}
          placeholder={placeholder}
          aria-invalid={a11y.isInvalid}
          aria-describedby={a11y.controlProps["aria-describedby"]}
          aria-readonly={readOnly || undefined}
          autoComplete="off"
          spellCheck={false}
          className="w-full"
          showTrigger={!readOnly}
        />
        <ComboboxContent container={listHost}>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxList>
            {(value: string) => (
              <ComboboxItem key={value} value={value}>
                {optionOf(value)?.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <div ref={listHost} data-slot="combobox-list-host" className="contents" />
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
