// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import type { DialogControl } from "@/components/simulations/name-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { m } from "@/i18n/messages";

/**
 * The confirmation of a destructive action (WCAG 3.3.4): its title names what goes, the body
 * says what follows, and Cancel takes the first focus. `onConfirm` runs once the dialog closes.
 */
export function ConfirmDialog({
  control,
  title,
  body,
  confirm,
  onConfirm,
}: Readonly<{
  control: DialogControl;
  title: string;
  body: ReactNode;
  confirm: string;
  onConfirm: () => void;
}>) {
  return (
    <AlertDialog open={control.open} onOpenChange={control.onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={control.onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.simulations_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              control.onOpenChange(false);
              onConfirm();
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
