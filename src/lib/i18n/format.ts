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

/** Formats a number with the decimal and grouping separators of the locale. */
export function formatNumber(
  value: number,
  options: FormatOptions & { maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(options.locale ?? getLocale(), {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}
