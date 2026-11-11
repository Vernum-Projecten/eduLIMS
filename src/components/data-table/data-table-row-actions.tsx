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
 * The menu of one row (#58): an icon button named after the row that opens its actions
 * (`children`, `DropdownMenuItem`s). `triggerRef` lets a dialog opened from the menu return
 * focus to the button (WCAG 2.4.3).
 */
export function DataTableRowActions({
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
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
