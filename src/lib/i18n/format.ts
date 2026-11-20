// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Locale-aware formatting for display. Instants are stored and compared in UTC; only the
// rendered text depends on the locale and the time zone.
import { getLocale, type Locale } from "@/i18n/runtime";

/** The time zone every date and time is shown in, whatever the server or browser runs in. */
export const APP_TIME_ZONE = "Europe/Amsterdam";

/** Options shared by the formatters; the locale defaults to the active one. */
export interface FormatOptions {
  locale?: Locale;
}

function toDate(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`invalid date: ${String(value)}`);
  return date;
}

/**
 * Formats an instant as a date and time in {@link APP_TIME_ZONE}.
 *
 * @throws RangeError when `value` is not a valid date or ISO string.
 */
export function formatDateTime(value: Date | string, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale ?? getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(toDate(value));
}

/**
 * Formats an instant as a calendar date in {@link APP_TIME_ZONE}.
 *
 * @throws RangeError when `value` is not a valid date or ISO string.
 */
export function formatDate(value: Date | string, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale ?? getLocale(), {
    dateStyle: "long",
    timeZone: APP_TIME_ZONE,
  }).format(toDate(value));
}

const RELATIVE_UNITS = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[];

/**
 * Formats how long before or after `from` the instant `value` lies ("3 days ago", "in 2 hours"),
 * in the largest whole unit. `from` is passed in, never read from the clock, so the server and
 * the browser render the same text.
 *
 * @throws RangeError when either value is not a valid date or ISO string.
 */
export function formatRelativeTime(
  value: Date | string,
  from: Date | string,
  options: FormatOptions = {},
): string {
  const seconds = Math.round((toDate(value).getTime() - toDate(from).getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(options.locale ?? getLocale(), { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, "second");
}

/**
 * Shows a decimal kept as text (a correct value, a limit; `src/lib/decimal.ts`) with the decimal
 * separator of the locale and every digit as stored: no rounding, no grouping, never through a
 * binary float.
 */
export function formatDecimal(value: string, options: FormatOptions = {}): string {
  const separator =
    new Intl.NumberFormat(options.locale ?? getLocale())
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return value.replace(".", separator);
}

/**
 * Formats a number with the decimal and grouping separators of the locale, with at most two
 * decimals unless `maximumFractionDigits` says otherwise; `minimumFractionDigits` pads (a
 * turnaround time of 7 minutes on one decimal reads "7.0").
 */
export function formatNumber(
  value: number,
  options: FormatOptions & { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  const minimum = options.minimumFractionDigits ?? 0;
  return new Intl.NumberFormat(options.locale ?? getLocale(), {
    minimumFractionDigits: minimum,
    maximumFractionDigits: Math.max(options.maximumFractionDigits ?? 2, minimum),
  }).format(value);
}

/**
 * Returns the message for `count` by the plural rule of the locale: `one` for the singular,
 * `other` for every other count, each given the count formatted for the locale. English and
 * Dutch have only these two forms.
 */
export function byCount(
  count: number,
  one: (count: string) => string,
  other: (count: string) => string,
  options: FormatOptions = {},
): string {
  const locale = options.locale ?? getLocale();
  const text = formatNumber(count, { locale });
  return new Intl.PluralRules(locale).select(count) === "one" ? one(text) : other(text);
}
