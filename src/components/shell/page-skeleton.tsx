// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";

/** The placeholder a page shows while its route loads; announced once as "Loading…". */
export function PageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-8">
      <span className="sr-only">{m.loading()}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
