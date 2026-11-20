// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { cn } from "@/lib/utils";

/** The id of every page's `h1`, which its main section is labelled by. */
export const PAGE_TITLE_ID = "page-title";

/**
 * The height of the window below the shell header (`h-14`) and the main area's `md:py-8`, which a
 * `fill` page takes on large screens.
 */
const FILL_HEIGHT = "lg:h-[calc(100svh-7.5rem)] lg:min-h-[32rem]";

/**
 * The fixed frame of every page (#384): the breadcrumb in the top bar names where it is, then this
 * frame gives the `h1`, one sentence of description, the page's one primary action and any
 * secondary actions, then the content. The whole page is one section labelled by its `h1`
 * (WCAG 1.3.1). The `h1` takes focus from code: a layout that swaps its page moves focus there,
 * and the ring shows whatever moved it (WCAG 2.4.3, 2.4.7).
 *
 * @param description - One sentence: what the page is for. A string renders as a paragraph;
 *   longer guidance belongs in the content, near what it explains.
 * @param action - The one primary action: a default `Button`, or nothing on a page that only
 *   reads.
 * @param secondary - Outline or ghost buttons, shown before the primary action. `actions` is the
 *   same slot under the name the earlier `Page` used.
 * @param fill - On large screens the page takes the window's height, so a list page keeps its
 *   toolbar and pager in view and only the table scrolls; the content gives the table
 *   `min-h-0 flex-1`. Narrow screens scroll the page as usual (WCAG 1.4.10).
 */
export function PageFrame({
  title,
  description,
  action,
  secondary,
  actions,
  fill = false,
  children,
}: Readonly<{
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
}>) {
  const hasActions = Boolean(action || secondary || actions);
  return (
    <section
      aria-labelledby={PAGE_TITLE_ID}
      className={cn("flex flex-col", fill ? cn("gap-6", FILL_HEIGHT) : "gap-8")}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            id={PAGE_TITLE_ID}
            tabIndex={-1}
            className={cn(FOCUSABLE_HEADING, "text-2xl tracking-tight text-balance")}
          >
            {title}
          </h1>
          {description && (
            <div className="max-w-prose text-muted-foreground text-pretty">
              {typeof description === "string" ? <p>{description}</p> : description}
            </div>
          )}
        </div>
        {hasActions && (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {actions}
            {secondary}
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
