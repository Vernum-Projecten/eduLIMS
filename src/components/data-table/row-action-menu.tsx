// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/admin-users/admin-action";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";

/** One action on a table row. */
export interface RowAction {
  readonly id: string;
  readonly icon: LucideIcon;
  /** The short visible text ("Remove"); the row names the person or thing. */
  readonly label: string;
  /**
   * The full name of the action when it stands alone as a button ("Remove Ada Visser"). It
   * starts with or contains `label`, so the visible text is part of the name (WCAG 2.5.3).
   */
  readonly accessibleName: string;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  /** Asks in an `AlertDialog` before `onRun`; without it the action runs at once. */
  readonly confirmation?: {
    readonly title: string;
    readonly description: ReactNode;
    readonly confirm: string;
  };
  readonly onRun: () => void;
}

/**
 * The actions of one table row: a single action is a short button, two or more sit in the
 * row's "⋯" menu, named after the row ({@link DataTableRowActions}). A destructive action comes
 * last, after a separator. Every confirmation returns focus to the button that opened it
 * (WCAG 2.4.3).
 */
export function RowActionMenu({
  name,
  actions,
}: Readonly<{ name: string; actions: readonly RowAction[] }>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const open = actions.find((action) => action.id === confirming);

  function start(action: RowAction) {
    if (action.confirmation) setConfirming(action.id);
    else action.onRun();
  }

  function returnFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  const [single, ...more] = actions;
  if (!single) return null;
  const safe = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);

  return (
    <div className="flex justify-end">
      {more.length === 0 ? (
        <Button
          ref={triggerRef}
          type="button"
          variant={single.destructive ? "ghost" : "outline"}
          size="sm"
          className={single.destructive ? "text-destructive hover:text-destructive" : undefined}
          aria-label={single.accessibleName}
          disabled={single.pending}
          onClick={() => start(single)}
        >
          <single.icon aria-hidden="true" data-icon="inline-start" />
          {single.label}
        </Button>
      ) : (
        <DataTableRowActions label={m.data_table_row_actions({ name })} triggerRef={triggerRef}>
          {safe.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.pending}
              onSelect={() => start(action)}
            >
              <action.icon aria-hidden="true" />
              {action.label}
            </DropdownMenuItem>
          ))}
          {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
          {destructive.map((action) => (
            <DropdownMenuItem
              key={action.id}
              variant="destructive"
              disabled={action.pending}
              onSelect={() => start(action)}
            >
              <action.icon aria-hidden="true" />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DataTableRowActions>
      )}
      {open?.confirmation && (
        <ConfirmDialog
          open
          onOpenChange={(next) => setConfirming(next ? open.id : null)}
          confirmation={open.confirmation}
          destructive={open.destructive ?? false}
          onConfirm={open.onRun}
          onCloseAutoFocus={returnFocus}
        />
      )}
    </div>
  );
}
