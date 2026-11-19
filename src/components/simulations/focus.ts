// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * Moves focus to the element with `id`, such as a section heading with `tabIndex={-1}`, once the
 * row that held focus is gone after a delete, so focus never drops to the page (WCAG 2.4.3).
 */
export function focusById(id: string): void {
  document.getElementById(id)?.focus();
}

/**
 * The classes of a section heading that takes focus from code: a visible ring whenever it has
 * focus, because a script moves focus there after a mouse click too (WCAG 2.4.7).
 */
export const FOCUSABLE_HEADING =
  "rounded-sm text-lg font-semibold outline-none focus:ring-3 focus:ring-ring/50";
