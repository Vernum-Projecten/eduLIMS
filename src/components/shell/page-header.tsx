// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The id of every page's `h1`, which its main section is labelled by. */
export const PAGE_TITLE_ID = "page-title";

/** The heading of every page: the `h1`, an optional description and optional actions. */
export function PageHeader({
  title,
  description,
  actions,
}: Readonly<{ title: string; description?: ReactNode; actions?: ReactNode }>) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 id={PAGE_TITLE_ID} className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description && <div className="text-muted-foreground text-pretty">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * The height of the window below the shell header (`h-14`) and the main area's `md:py-8`, which a
 * `fill` page takes on large screens.
 */
const FILL_HEIGHT = "lg:h-[calc(100svh-7.5rem)] lg:min-h-[32rem]";

/**
 * A page: its header, then its content, as one section labelled by the `h1`.
 *
 * @param fill - On large screens the page takes the window's height, so a list page keeps its
 *   toolbar and pager in view and only the table scrolls; the content gives the table
 *   `min-h-0 flex-1`. Narrow screens scroll the page as usual (WCAG 1.4.10).
 */
export function Page({
  title,
  description,
  actions,
  fill = false,
  children,
}: Readonly<{
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
}>) {
  return (
    <section
      aria-labelledby={PAGE_TITLE_ID}
      className={cn("flex flex-col", fill ? cn("gap-6", FILL_HEIGHT) : "gap-8")}
    >
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </section>
  );
}
