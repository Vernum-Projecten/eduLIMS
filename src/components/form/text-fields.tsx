// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ComponentProps } from "react";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InputExtras = Pick<
  ComponentProps<"input">,
  "autoComplete" | "inputMode" | "maxLength" | "placeholder" | "spellCheck" | "disabled"
>;

/** A one-line text field for a `string` value. */
export function TextField({
  label,
  description,
  className,
  id,
  type = "text",
  ...input
}: BaseFieldProps &
  InputExtras & {
    readonly type?: "text" | "email" | "url" | "search" | "tel" | "password";
  }) {
  const field = useFieldContext<string>();
  const a11y = useFieldA11y(field, description, id);
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Input
        {...input}
        {...a11y.controlProps}
        type={type}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}

/** A multi-line text field for a `string` value. */
export function TextareaField({
  label,
  description,
  className,
  id,
  ...textarea
}: BaseFieldProps &
  Pick<ComponentProps<"textarea">, "maxLength" | "placeholder" | "rows" | "disabled">) {
  const field = useFieldContext<string>();
  const a11y = useFieldA11y(field, description, id);
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Textarea
        {...textarea}
        {...a11y.controlProps}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}

/**
 * A number field for a `number` value. An empty or unreadable entry is `NaN`, which the form's
 * schema refuses with its own message, so the field never invents a zero.
 */
export function NumberField({
  label,
  description,
  className,
  id,
  ...input
}: BaseFieldProps & Pick<ComponentProps<"input">, "min" | "max" | "step" | "disabled">) {
  const field = useFieldContext<number>();
  const a11y = useFieldA11y(field, description, id);
  const value = field.state.value;
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Input
        {...input}
        {...a11y.controlProps}
        type="number"
        inputMode="decimal"
        value={Number.isNaN(value) ? "" : value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.valueAsNumber)}
      />
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
