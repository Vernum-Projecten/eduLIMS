// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useId } from "react";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** One choice of a select, radio or checkbox group: its value and its translated label. */
export interface FieldOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Help text under the choice. */
  readonly description?: string;
}

/** A select for one of `options`; `""` is no choice yet and shows `placeholder`. */
export function SelectField<T extends string>({
  label,
  description,
  className,
  id,
  options,
  placeholder,
}: BaseFieldProps & {
  readonly options: readonly FieldOption<T>[];
  readonly placeholder: string;
}) {
  const field = useFieldContext<T | "">();
  const a11y = useFieldA11y(field, description, id);
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <Select
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => {
          const option = options.find((o) => o.value === value);
          if (option) field.handleChange(option.value);
        }}
        onOpenChange={(open) => {
          if (!open) field.handleBlur();
        }}
      >
        <SelectTrigger
          id={a11y.controlId}
          aria-invalid={a11y.isInvalid}
          aria-describedby={a11y.controlProps["aria-describedby"]}
          className="w-full sm:w-72"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}

/** A single checkbox for a `boolean` value, its label beside it. */
export function CheckboxField({ label, description, className, id }: BaseFieldProps) {
  const field = useFieldContext<boolean>();
  const a11y = useFieldA11y(field, description, id);
  return (
    <Field orientation="horizontal" data-invalid={a11y.isInvalid} className={className}>
      <Checkbox
        {...a11y.controlProps}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
        onBlur={field.handleBlur}
      />
      <FieldContent>
        <FieldLabel htmlFor={a11y.controlId} className="font-normal">
          {label}
        </FieldLabel>
        <FieldFeedback a11y={a11y} description={description} />
      </FieldContent>
    </Field>
  );
}

/** A switch for a `boolean` setting that applies at once in the form, its label beside it. */
export function SwitchField({ label, description, className, id }: BaseFieldProps) {
  const field = useFieldContext<boolean>();
  const a11y = useFieldA11y(field, description, id);
  return (
    <Field orientation="horizontal" data-invalid={a11y.isInvalid} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
        <FieldFeedback a11y={a11y} description={description} />
      </FieldContent>
      <Switch
        {...a11y.controlProps}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        onBlur={field.handleBlur}
      />
    </Field>
  );
}

/**
 * A group of checkboxes for a `T[]` value, named by its legend. `toggle` keeps the set inside
 * its rules (the role sets of ADR 0012); without it a choice is added or removed.
 */
export function CheckboxGroupField<T extends string>({
  label,
  description,
  className,
  id,
  options,
  toggle,
}: BaseFieldProps & {
  readonly options: readonly FieldOption<T>[];
  readonly toggle?: (current: readonly T[], value: T, checked: boolean) => T[];
}) {
  const field = useFieldContext<T[]>();
  const a11y = useFieldA11y(field, description, id);
  const base = useId();
  const next = (value: T, checked: boolean): T[] => {
    if (toggle) return toggle(field.state.value, value, checked);
    const others = field.state.value.filter((held) => held !== value);
    return checked
      ? options.map((o) => o.value).filter((v) => v === value || others.includes(v))
      : others;
  };
  return (
    <FieldSet data-invalid={a11y.isInvalid} className={className}>
      <FieldLegend variant="label">{label}</FieldLegend>
      {description && <FieldDescription id={a11y.descriptionId}>{description}</FieldDescription>}
      <div data-slot="checkbox-group" className="flex flex-col gap-2">
        {options.map((option) => {
          const id = `${base}${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal" data-invalid={a11y.isInvalid}>
              <Checkbox
                id={id}
                name={field.name}
                value={option.value}
                checked={field.state.value.includes(option.value)}
                onCheckedChange={(checked) =>
                  field.handleChange(next(option.value, checked === true))
                }
                onBlur={field.handleBlur}
                aria-invalid={a11y.isInvalid}
                aria-describedby={a11y.controlProps["aria-describedby"]}
              />
              <FieldContent>
                <FieldLabel htmlFor={id} className="font-normal">
                  {option.label}
                </FieldLabel>
                {option.description && <FieldDescription>{option.description}</FieldDescription>}
              </FieldContent>
            </Field>
          );
        })}
      </div>
      <FieldFeedback a11y={a11y} description={null} />
    </FieldSet>
  );
}

/** A radio group for one of `options`, named by its legend; `""` is no choice yet. */
export function RadioGroupField<T extends string>({
  label,
  description,
  className,
  id,
  options,
}: BaseFieldProps & { readonly options: readonly FieldOption<T>[] }) {
  const field = useFieldContext<T | "">();
  const a11y = useFieldA11y(field, description, id);
  const base = useId();
  const legendId = `${base}legend`;
  return (
    <FieldSet data-invalid={a11y.isInvalid} className={className}>
      <FieldLegend id={legendId} variant="label">
        {label}
      </FieldLegend>
      {description && <FieldDescription id={a11y.descriptionId}>{description}</FieldDescription>}
      <RadioGroup
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => {
          const option = options.find((o) => o.value === value);
          if (option) field.handleChange(option.value);
        }}
        onBlur={field.handleBlur}
        aria-labelledby={legendId}
        aria-invalid={a11y.isInvalid}
        aria-describedby={a11y.controlProps["aria-describedby"]}
      >
        {options.map((option) => {
          const id = `${base}${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal" data-invalid={a11y.isInvalid}>
              <RadioGroupItem id={id} value={option.value} aria-invalid={a11y.isInvalid} />
              <FieldContent>
                <FieldLabel htmlFor={id} className="font-normal">
                  {option.label}
                </FieldLabel>
                {option.description && <FieldDescription>{option.description}</FieldDescription>}
              </FieldContent>
            </Field>
          );
        })}
      </RadioGroup>
      <FieldFeedback a11y={a11y} description={null} />
    </FieldSet>
  );
}
