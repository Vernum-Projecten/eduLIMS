// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { TriangleAlertIcon } from "lucide-react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { roleLabel } from "@/lib/i18n/labels";
import { ROLES } from "@/lib/roles";

/** Returns the eduLIMS roles as select options, in the active locale. */
export function roleOptions() {
  return ROLES.map((role) => ({ value: role, label: roleLabel(role) }));
}

/**
 * One labelled switch of the provider form, with its help text and an optional warning that
 * shows as an icon and text, never colour alone (WCAG 1.4.1).
 */
export function SwitchControl({
  id,
  name,
  checked,
  onCheckedChange,
  label,
  help,
  warning,
}: Readonly<{
  id: string;
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  help: string;
  warning?: string;
}>) {
  return (
    <Field orientation="horizontal">
      <Switch id={id} name={name} checked={checked} onCheckedChange={onCheckedChange} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{help}</FieldDescription>
        {warning && (
          <p className="flex gap-2 text-sm text-foreground">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{warning}</span>
          </p>
        )}
      </FieldContent>
    </Field>
  );
}

/** One labelled native select of the provider form. */
export function SelectControl({
  id,
  name,
  label,
  help,
  value,
  options,
  onValueChange,
  className,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  help?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  className?: string;
}>) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        name={name}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}

/** One labelled whole-number field of the provider form (0 to 999). */
export function NumberControl({
  id,
  name,
  label,
  help,
  value,
  onBlur,
  onValueChange,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  help: string;
  value: number;
  onBlur: () => void;
  onValueChange: (value: number) => void;
}>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        value={value}
        onBlur={onBlur}
        onChange={(e) => onValueChange(Number(e.target.value))}
      />
      <FieldDescription>{help}</FieldDescription>
    </Field>
  );
}
