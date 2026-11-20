// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { PAGE_TITLE_ID } from "@/components/shell/page-header";

/**
 * The fixed frame of a page (#384): the breadcrumb in the top bar names where it is, then this
 * frame gives the `h1`, one sentence of description, the page's one primary action and any
 * secondary actions, then the content. The `h1` takes focus from code after a navigation inside
 * a layout (WCAG 2.4.3), and the whole page is one section labelled by it (WCAG 1.3.1).
 *
 * @param description - One sentence: what the page is for. Longer guidance belongs in the
 *   content, near what it explains.
 * @param action - The one primary action: a default `Button`, or nothing on a page that only
 *   reads.
 * @param secondary - Outline or ghost buttons, shown before the primary action.
 */
export function PageFrame({
  title,
  description,
  action,
  secondary,
  children,
}: Readonly<{
  title: string;
  description: string;
  action?: ReactNode;
  secondary?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <section aria-labelledby={PAGE_TITLE_ID} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            id={PAGE_TITLE_ID}
            tabIndex={-1}
            className="rounded-sm font-semibold text-2xl tracking-tight text-balance outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {title}
          </h1>
          <p className="max-w-prose text-muted-foreground text-pretty">{description}</p>
        </div>
        {(action || secondary) && (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {secondary}
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
