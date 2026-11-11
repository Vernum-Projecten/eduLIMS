// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The bridge between a form's `YYYY-MM-DD` day and the `Date` react-day-picker works with. The
// picker shows local calendar days, so a day is a local `Date` at noon, far from any midnight a
// daylight-saving change could move.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns a `YYYY-MM-DD` day as a local `Date` at noon.
 *
 * @throws RangeError when `day` is not a `YYYY-MM-DD` date.
 */
export function dayToDate(day: string): Date {
  const match = DAY.exec(day);
  if (!match) throw new RangeError(`invalid day: ${day}`);
  const [, year, month, date] = match;
  return new Date(Number(year), Number(month) - 1, Number(date), 12);
}

/** Returns the local calendar day of `date` as `YYYY-MM-DD`. */
export function dateToDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
