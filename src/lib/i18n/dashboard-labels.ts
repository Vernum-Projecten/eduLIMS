// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The words of the teacher dashboard (D11, #271): a duration, an accuracy status and the
// accessible name of a cell, each from the i18n layer (ADR 0011).
import { m } from "@/i18n/messages";
import type { AccuracyStatus } from "@/lib/dashboard";
import type { BoardCell, BoardColumn } from "@/lib/dashboard-board";
import { formatDecimal, formatNumber } from "@/lib/i18n/format";

const MINUTE_MS = 60_000;

/**
 * Formats a duration in whole minutes, in hours and minutes from one hour on ("1 h 05 min"
 * reads "1 h 5 min"); under a minute it says so. Rounded down, so a time is never overstated.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (minutes < 1) return m.dashboard_duration_under_minute();
  if (minutes < 60) return m.dashboard_duration_minutes({ minutes: formatNumber(minutes) });
  return m.dashboard_duration_hours({
    hours: formatNumber(Math.floor(minutes / 60)),
    minutes: formatNumber(minutes % 60),
  });
}

/** Returns the text of an accuracy status; `null` (no limits) reads as such. */
export function accuracyStatusLabel(status: AccuracyStatus | null): string {
  switch (status) {
    case "green":
      return m.dashboard_status_green();
    case "yellow":
      return m.dashboard_status_yellow();
    case "red":
      return m.dashboard_status_red();
    case null:
      return m.dashboard_status_unknown();
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/** Returns a value with its column's unit, in the active locale's decimal separator. */
export function valueWithUnit(value: string, column: Pick<BoardColumn, "unit">): string {
  const text = formatDecimal(value);
  return column.unit ? `${text} ${column.unit}` : text;
}

/**
 * Returns the accessible name of a board cell: "lab, sample, test: value, status", or for a
 * cell not released yet its {@link pendingText}.
 */
export function cellLabel(
  lab: string,
  column: BoardColumn,
  cell: BoardCell | undefined,
  readAt: string,
): string {
  const where = { lab, sample: column.sampleNumber, test: column.testName };
  if (cell === undefined) {
    return m.dashboard_cell_not_requested({ ...where, state: m.dashboard_state_not_requested() });
  }
  if (cell.state === "released") {
    return m.dashboard_cell_released({
      ...where,
      value: valueWithUnit(cell.value, column),
      status: accuracyStatusLabel(cell.status),
    });
  }
  return m.dashboard_cell_pending({ ...where, state: pendingText(cell, readAt) });
}

/**
 * Returns the visible text of a cell not released yet: its state and how long it has been open
 * ("Open, 5 min"), the same words its accessible name ends with (WCAG 2.5.3).
 */
export function pendingText(cell: BoardCell, readAt: string): string {
  const state = cell.state === "measured" ? m.dashboard_state_measured() : m.dashboard_state_open();
  return `${state}, ${formatDuration(Date.parse(readAt) - Date.parse(cell.enteredAt))}`;
}
