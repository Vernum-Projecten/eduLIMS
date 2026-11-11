// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";

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

/** A page: its header, then its content, as one section labelled by the `h1`. */
export function Page({
  title,
  description,
  actions,
  children,
}: Readonly<{
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <section aria-labelledby={PAGE_TITLE_ID} className="flex flex-col gap-8">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </section>
  );
}
