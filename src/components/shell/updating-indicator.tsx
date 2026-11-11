// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Spinner } from "@/components/ui/spinner";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/**
 * The translated "Updating…" badge of a background refetch. It always takes its place in the
 * corner of the nearest positioned parent and is only made visible while `active`, so showing
 * it never moves the layout. It is hidden from assistive technology: the region it sits on
 * carries `aria-busy` instead, so a refetch is not announced every time.
 */
export function UpdatingIndicator({
  active,
  className,
}: Readonly<{ active: boolean; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      data-slot="updating-indicator"
      className={cn(
        "pointer-events-none absolute top-1.5 right-2 z-20 flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground shadow-sm",
        !active && "invisible",
        className,
      )}
    >
      {active && <Spinner className="size-3" />}
      {m.data_table_updating()}
    </span>
  );
}
