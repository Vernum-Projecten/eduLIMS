// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from "react";
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

/** The item that stands for the empty value when `none` is offered; no option can take it. */
const NONE = "\u0000none";

/** Returns whether `text` holds `query`, ignoring case. */
function matches(text: string, query: string): boolean {
  return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

/** A choice of a combobox: an option with extra text a search may match. */
export interface ComboboxOption<T extends string> extends FieldOption<T> {
  /** Words the search matches besides the label, such as a code the label spells differently. */
  readonly keywords?: string;
}

/**
 * A searchable select for one of `options` (the shadcn combobox on Base UI): typing filters the
 * list on each option's label and keywords. `""` is no choice; with `none` it is a choice of its
 * own, listed first under that label (a unit field's "No unit"). With `readOnly` the input stays
 * focusable and announces `aria-readonly`, but no choice changes the value (WCAG 3.3.2).
 */
export function ComboboxField<T extends string>({
  label,
  description,
  className,
  id,
  options,
  placeholder,
  emptyText,
  none,
  readOnly = false,
}: BaseFieldProps & {
  readonly options: readonly ComboboxOption<T>[];
  readonly placeholder: string;
  /** Shown when the search matches no option. */
  readonly emptyText: string;
  /** The label of the empty value, when the empty value is a valid choice. */
  readonly none?: string;
  readonly readOnly?: boolean;
}) {
  const field = useFieldContext<T | "">();
  const a11y = useFieldA11y(field, description, id);
  const items = useMemo(
    () =>
      none === undefined ? options.map((o) => o.value) : [NONE, ...options.map((o) => o.value)],
    [options, none],
  );
  const optionOf = (value: string) => options.find((o) => o.value === value);
  const labelOf = (value: string) =>
    value === NONE ? (none ?? "") : (optionOf(value)?.label ?? "");
  const searchText = (value: string) => {
    const option = optionOf(value);
    return option ? `${option.label} ${option.keywords ?? ""}` : labelOf(value);
  };
  const current = field.state.value;
  const selected = current === "" ? (none === undefined ? null : NONE) : current;

  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Combobox
        items={items}
        value={selected}
        readOnly={readOnly}
        itemToStringLabel={labelOf}
        filter={(item: string, query: string) => matches(searchText(item), query)}
        onValueChange={(value: string | null) => {
          if (readOnly) return;
          if (value === null || value === NONE) {
            field.handleChange("");
            return;
          }
          const option = optionOf(value);
          if (option) field.handleChange(option.value);
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
          className="w-full sm:w-72"
          showTrigger={!readOnly}
        />
        <ComboboxContent>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {labelOf(item)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
