// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The `…` menu of one item (#384): an icon button named after the item that opens its actions
 * (`children`, `DropdownMenuItem`s), so a list row carries one control instead of a row of
 * buttons. A dialog an item opens closes back to `triggerRef`, the button itself, because the
 * menu is gone by then (WCAG 2.4.3). A destructive item uses `variant="destructive"` and comes
 * last; each item has an icon and its text.
 *
 * @param label - The accessible name, naming the item: "Actions for Lab Aurora".
 */
export function RowActions({
  label,
  triggerRef,
  onCloseAutoFocus,
  children,
}: Readonly<{
  label: string;
  triggerRef?: Ref<HTMLButtonElement>;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}>) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
