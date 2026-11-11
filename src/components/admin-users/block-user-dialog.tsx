// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { BanIcon, CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { nl } from "react-day-picker/locale";
import { useAdminAction } from "@/components/admin-users/admin-action";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { m } from "@/i18n/messages";
import { getLocale } from "@/i18n/runtime";
import { dayIn, endOfDayIn } from "@/lib/app-day";
import { formatDate } from "@/lib/i18n/format";
import { blockAdminUser } from "@/server/users/functions";
import { BLOCK_REASON_MAX_LENGTH, blockUserFormSchema } from "@/server/users/schemas";

/** Returns a `YYYY-MM-DD` day as a local `Date` at noon, as the calendar shows days. */
function dayToDate(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12);
}

/** Returns the local calendar day of a `Date` the calendar picked as `YYYY-MM-DD`. */
function dateToDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Names a day button by its full date in the active locale ("Friday, November 27, 2026"), so
 * the visible day number is part of the accessible name (WCAG 2.5.3).
 */
function labelDayButton(date: Date, modifiers: { today?: boolean; selected?: boolean }): string {
  const full = new Intl.DateTimeFormat(getLocale(), { dateStyle: "full" }).format(date);
  const named = modifiers.today ? m.calendar_today({ date: full }) : full;
  return modifiers.selected ? m.calendar_selected({ date: named }) : named;
}

/**
 * The block action (owner decision on #32): an `AlertDialog` with the reason and an optional
 * last day, confirming that the user is signed out and refused at every sign-in.
 */
export function BlockUserDialog({ userId, name }: Readonly<{ userId: string; name: string }>) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const block = useAdminAction(blockAdminUser, () => m.admin_users_block_done({ name }));
  const form = useForm({
    defaultValues: { reason: "", until: "" },
    validators: { onSubmit: blockUserFormSchema },
    onSubmit: async ({ value }) => {
      const result = await block.mutateAsync({ userId, ...value });
      if (result.ok) {
        setOpen(false);
        form.reset();
      }
    },
  });
  const tomorrow = dayToDate(dayIn(new Date(Date.now() + 86_400_000)));

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BanIcon aria-hidden="true" data-icon="inline-start" className="text-destructive" />
          {m.admin_users_block()}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{m.admin_users_block_title({ name })}</AlertDialogTitle>
            <AlertDialogDescription>{m.admin_users_block_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <form.Field name="reason">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor="block-reason">{m.admin_users_block_reason()}</FieldLabel>
                    <Textarea
                      id="block-reason"
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      aria-describedby="block-reason-help"
                      maxLength={BLOCK_REASON_MAX_LENGTH}
                      rows={3}
                    />
                    <FieldDescription id="block-reason-help">
                      {m.admin_users_block_reason_help()}
                    </FieldDescription>
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="until">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const value = field.state.value;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor="block-until">{m.admin_users_block_until()}</FieldLabel>
                    <div className="flex gap-2">
                      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            id="block-until"
                            type="button"
                            variant="outline"
                            className="flex-1 justify-start font-normal"
                            aria-invalid={isInvalid}
                            aria-describedby="block-until-help"
                          >
                            <CalendarIcon aria-hidden="true" data-icon="inline-start" />
                            {value
                              ? formatDate(new Date(endOfDayIn(value).getTime() - 1))
                              : m.admin_users_block_until_none()}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            {...(getLocale() === "nl" ? { locale: nl } : {})}
                            labels={{ labelDayButton }}
                            selected={value ? dayToDate(value) : undefined}
                            defaultMonth={value ? dayToDate(value) : tomorrow}
                            disabled={{ before: tomorrow }}
                            onSelect={(date) => {
                              field.handleChange(date ? dateToDay(date) : "");
                              field.handleBlur();
                              setPickerOpen(false);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                      {value && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={m.admin_users_block_until_clear()}
                          onClick={() => field.handleChange("")}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    <FieldDescription id="block-until-help">
                      {m.admin_users_block_until_help()}
                    </FieldDescription>
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>
          <AlertDialogFooter className="-mx-4 -mb-4">
            <AlertDialogCancel type="button">{m.admin_users_cancel()}</AlertDialogCancel>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  <BanIcon aria-hidden="true" data-icon="inline-start" />
                  {m.admin_users_block_confirm()}
                </Button>
              )}
            </form.Subscribe>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
