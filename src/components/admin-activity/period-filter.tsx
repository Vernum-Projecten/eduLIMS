// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CalendarRangeIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { addToRange, type DateRange } from "react-day-picker";
import type { DataTableColumn } from "@/components/data-table/features";
import { formatDay, labelDayButton } from "@/components/form/date-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { m } from "@/i18n/messages";
import { dateToDay, dayToDate } from "@/lib/forms/calendar-day";
import type { ActivityRow } from "@/server/activity/queries";
import { type ActivityPeriod, periodOf } from "@/server/activity/table-state";

/** Returns the period as the calendar's range: no range without a start. */
function rangeOf(period: ActivityPeriod): DateRange | undefined {
  return period.from
    ? { from: dayToDate(period.from), to: period.to ? dayToDate(period.to) : undefined }
    : undefined;
}

/** Returns the period after a pick of `day`, as the calendar's range mode adds it to `period`. */
function pickDay(period: ActivityPeriod, day: Date): ActivityPeriod | undefined {
  const range = addToRange(day, rangeOf(period));
  const next: ActivityPeriod = {
    from: range?.from ? dateToDay(range.from) : undefined,
    to: range?.to ? dateToDay(range.to) : undefined,
  };
  return next.from || next.to ? next : undefined;
}

/** Returns the period as the filter button shows it ("1 November 2026 to 10 November 2026"). */
function periodLabel(period: ActivityPeriod): string | null {
  const { from, to } = period;
  if (from && to) {
    return from === to
      ? formatDay(from)
      : m.admin_activity_period_range({ from: formatDay(from), to: formatDay(to) });
  }
  if (from) return m.admin_activity_period_from({ date: formatDay(from) });
  if (to) return m.admin_activity_period_to({ date: formatDay(to) });
  return null;
}

/**
 * The period filter of the activity log (#36), the shadcn date-range pattern: a button that
 * opens the localised `Calendar` in range mode. The first day picked starts the period, the
 * second ends it; each pick applies at once. The days are calendar days in the app's time
 * zone, which the hint says, and a button clears the period.
 */
export function PeriodFilter({
  column,
  title,
}: Readonly<{ column: DataTableColumn<ActivityRow>; title: string }>) {
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const period = periodOf(column.getFilterValue()) ?? {};
  const label = periodLabel(period);
  const selected = rangeOf(period);
  const month = period.from ? dayToDate(period.from) : period.to ? dayToDate(period.to) : undefined;

  // An updater from the picked day, so a second pick before the re-render keeps the first (#194).
  function apply(_range: DateRange | undefined, day: Date) {
    column.setFilterValue((old: unknown) => pickDay(periodOf(old) ?? {}, day));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <CalendarRangeIcon aria-hidden="true" data-icon="inline-start" />
          {title}
          {label && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <span className="sr-only">:</span>
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {label}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-2 p-2"
        align="start"
        aria-label={title}
        aria-describedby={hintId}
      >
        <p id={hintId} className="max-w-64 px-1 text-sm text-muted-foreground">
          {m.admin_activity_period_hint()}
        </p>
        <Calendar
          mode="range"
          labels={{ labelDayButton }}
          selected={selected}
          {...(month ? { defaultMonth: month } : {})}
          onSelect={apply}
        />
        {label && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              column.setFilterValue(undefined);
              setOpen(false);
            }}
          >
            <XIcon aria-hidden="true" data-icon="inline-start" />
            {m.admin_activity_period_clear()}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
