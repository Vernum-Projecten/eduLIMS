// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { m } from "@/i18n/messages";
import { getLocale } from "@/i18n/runtime";
import { endOfDayIn } from "@/lib/app-day";
import { dateToDay, dayToDate } from "@/lib/forms/calendar-day";
import { formatDate } from "@/lib/i18n/format";

/**
 * Names a day button by its full date in the active locale ("Friday, November 27, 2026"), so
 * the visible day number is part of the accessible name (WCAG 2.5.3).
 */
export function labelDayButton(
  date: Date,
  modifiers: { today?: boolean; selected?: boolean },
): string {
  const full = new Intl.DateTimeFormat(getLocale(), { dateStyle: "full" }).format(date);
  const named = modifiers.today ? m.calendar_today({ date: full }) : full;
  return modifiers.selected ? m.calendar_selected({ date: named }) : named;
}

/** Formats a `YYYY-MM-DD` day in the active locale, as that day in the app's time zone. */
export function formatDay(day: string): string {
  return formatDate(new Date(endOfDayIn(day).getTime() - 1));
}

/**
 * A date picker for a `YYYY-MM-DD` value (`""` is no date), on the shadcn `Calendar` in the
 * active locale. The trigger is the labelled control and shows the chosen day or `emptyLabel`;
 * a clear button empties an optional date.
 */
export function DateField({
  label,
  description,
  className,
  id,
  emptyLabel = m.form_date_none(),
  clearLabel = m.form_date_clear(),
  minDay,
  optional = true,
}: BaseFieldProps & {
  readonly emptyLabel?: string;
  readonly clearLabel?: string;
  /** The first day that can be picked, as `YYYY-MM-DD`; the calendar opens on it. */
  readonly minDay?: string;
  /** Whether the date can be cleared again. */
  readonly optional?: boolean;
}) {
  const field = useFieldContext<string>();
  const a11y = useFieldA11y(field, description, id);
  const [open, setOpen] = useState(false);
  const value = field.state.value;
  const first = minDay ? dayToDate(minDay) : undefined;
  const month = value ? dayToDate(value) : first;
  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel htmlFor={a11y.controlId}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) field.handleBlur();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              {...a11y.controlProps}
              type="button"
              variant="outline"
              className="flex-1 justify-start font-normal"
            >
              <CalendarIcon aria-hidden="true" data-icon="inline-start" />
              {value ? formatDay(value) : emptyLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              labels={{ labelDayButton }}
              selected={value ? dayToDate(value) : undefined}
              {...(month ? { defaultMonth: month } : {})}
              {...(first ? { disabled: { before: first } } : {})}
              onSelect={(date) => {
                field.handleChange(date ? dateToDay(date) : "");
                field.handleBlur();
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        {optional && value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={clearLabel}
            onClick={() => field.handleChange("")}
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
