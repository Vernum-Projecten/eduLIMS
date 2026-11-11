// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Calendar days in the app's time zone (ADR 0011): a day an administrator picks means that
// day in APP_TIME_ZONE, wherever the browser or the server runs.
import { APP_TIME_ZONE } from "./i18n/format.ts";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the calendar date of `now` in `timeZone` as `YYYY-MM-DD`. */
export function dayIn(now: Date, timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Returns how far `timeZone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Returns the instant the calendar day `day` (`YYYY-MM-DD`) ends in `timeZone`: midnight at the
 * start of the next day, across a daylight-saving change too.
 *
 * @throws RangeError when `day` is not a `YYYY-MM-DD` date.
 */
export function endOfDayIn(day: string, timeZone: string = APP_TIME_ZONE): Date {
  const match = DAY.exec(day);
  if (!match) throw new RangeError(`invalid day: ${day}`);
  const [, year, month, date] = match;
  const midnightUtc = Date.UTC(Number(year), Number(month) - 1, Number(date) + 1);
  const first = midnightUtc - zoneOffset(new Date(midnightUtc), timeZone);
  const second = midnightUtc - zoneOffset(new Date(first), timeZone);
  return new Date(second);
}
