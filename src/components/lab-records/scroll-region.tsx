// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";

// NOTE: WCAG 2.1.1 and 1.4.10; the same container as the data table's: a wide table scrolls in
// a named region the keyboard can reach and scroll, never the page.
const SCROLL_REGION =
  "relative overflow-x-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot=table-container]]:overflow-visible";

/** A keyboard-reachable scroll region around a table, named by its heading. */
export function ScrollRegion({
  id,
  label,
  children,
}: Readonly<{ id?: string; label: string; children: ReactNode }>) {
  return (
    <section
      id={id}
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1).
      tabIndex={0}
      className={SCROLL_REGION}
    >
      {children}
    </section>
  );
}
