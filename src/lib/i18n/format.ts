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

/** Formats a number with the decimal and grouping separators of the locale. */
export function formatNumber(
  value: number,
  options: FormatOptions & { maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(options.locale ?? getLocale(), {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}
