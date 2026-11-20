// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from "react";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * A field that picks one file, for a `File | null` value. The browser owns the control's value,
 * so the field empties the control when the form's value goes back to `null` (a reset after an
 * upload). `accept` only filters the browser's file picker; the form's schema and the server
 * still check the file.
 */
export function FileField({
  label,
  description,
  className,
  id,
  accept,
  disabled,
}: BaseFieldProps & { readonly accept?: string; readonly disabled?: boolean }) {
  const field = useFieldContext<File | null>();
  const a11y = useFieldA11y(field, description, id);
  const input = useRef<HTMLInputElement>(null);
  const empty = field.state.value === null;
  useEffect(() => {
    if (empty && input.current) input.current.value = "";
  }, [empty]);
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Input
        {...a11y.controlProps}
        ref={input}
        type="file"
        accept={accept}
        disabled={disabled}
        className="h-auto py-1.5"
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.files?.[0] ?? null)}
      />
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
