// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** A control of a row in an array editor. */
export type RowControl = "up" | "down" | "remove";

/**
 * Returns the control of a moved row that keeps the keyboard focus: the one that moved it, or
 * the opposite one when the row reached the edge and that button is now disabled, or the
 * remove button when the row is alone (WCAG 2.4.3: focus never falls back to the page).
 */
export function controlAfterMove(to: number, count: number, direction: "up" | "down"): RowControl {
  if (count <= 1) return "remove";
  const first = to <= 0;
  const last = to >= count - 1;
  if (direction === "up") return first ? "down" : "up";
  return last ? "up" : "down";
}
