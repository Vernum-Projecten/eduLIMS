// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The part of a TanStack Form field API a text control reads and writes. */
export interface TextFieldApi {
  name: string;
  state: {
    value: string;
    meta: { isTouched: boolean; isValid: boolean; errors: Array<{ message?: string } | undefined> };
  };
  handleBlur: () => void;
  handleChange: (value: string) => void;
}

/**
 * One labelled text field of the provider form (shadcn Field + TanStack Form): an input or a
 * text area, its help text, and its error, or the server's refusal for it (WCAG 3.3.1).
 */
export function TextControl({
  field,
  id,
  label,
  help,
  serverError = null,
  type = "text",
  rows,
  disabled,
  mono,
  className,
}: Readonly<{
  field: TextFieldApi;
  id: string;
  label: string;
  help?: string | undefined;
  serverError?: string | null;
  type?: "text" | "url" | "password";
  /** A text area with this many rows instead of an input. */
  rows?: number;
  disabled?: boolean;
  mono?: boolean;
  className?: string;
}>) {
  const { meta } = field.state;
  const isInvalid = serverError !== null || (meta.isTouched && !meta.isValid);
  const common = {
    id,
    name: field.name,
    value: field.state.value,
    onBlur: field.handleBlur,
    "aria-invalid": isInvalid,
    spellCheck: false,
  };
  return (
    <Field data-invalid={isInvalid} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {rows ? (
        <Textarea
          {...common}
          rows={rows}
          onChange={(e) => field.handleChange(e.target.value)}
          className={cn(mono && "font-mono text-xs")}
        />
      ) : (
        <Input
          {...common}
          type={type}
          disabled={disabled}
          autoComplete={type === "password" ? "new-password" : "off"}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      )}
      {help && <FieldDescription>{help}</FieldDescription>}
      {isInvalid && <FieldError errors={serverError ? [{ message: serverError }] : meta.errors} />}
    </Field>
  );
}
