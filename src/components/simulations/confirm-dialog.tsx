// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type ReactNode, type RefObject, useRef, useState } from "react";
import { focusById } from "@/components/simulations/focus";
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
import { Spinner } from "@/components/ui/spinner";
import { m } from "@/i18n/messages";

/** One confirmation: whether it is open, and where focus goes when it closes. */
export interface Confirmation {
  control: DialogControl;
  /** The button that opens it; focus returns there after a cancel or a failure. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  show: () => void;
  /** Closes it after the action succeeded: focus goes to `doneFocusId`. */
  done: () => void;
  /** Closes it after the action failed or was refused: focus goes back to the trigger. */
  failed: () => void;
}

/**
 * Returns the state of a confirmation. The caller wires `done` and `failed` to the action's
 * mutation (`onDone`, `onFailed`), which run before the list refetches, while the row is still
 * there. On close, focus goes to the element `doneFocusId` names (a section heading) after a
 * success, or back to the trigger otherwise; without `doneFocusId` a success leaves focus to the
 * page the action navigates to (WCAG 2.4.3).
 */
export function useConfirmation(doneFocusId?: string): Confirmation {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const succeeded = useRef(false);
  return {
    triggerRef,
    show: () => {
      succeeded.current = false;
      setOpen(true);
    },
    done: () => {
      succeeded.current = true;
      setOpen(false);
    },
    failed: () => {
      succeeded.current = false;
      setOpen(false);
    },
    control: {
      open,
      onOpenChange: setOpen,
      onCloseAutoFocus: (event) => {
        event.preventDefault();
        if (!succeeded.current) triggerRef.current?.focus();
        else if (doneFocusId) focusById(doneFocusId);
      },
    },
  };
}

/**
 * The confirmation of a destructive action (WCAG 3.3.4): its title names what goes, the body
 * says what follows, and Cancel takes the first focus. The dialog stays open while the action
 * runs; the action's mutation closes it through {@link Confirmation.done} or
 * {@link Confirmation.failed}, which decide where focus goes.
 */
export function ConfirmDialog({
  confirmation,
  title,
  body,
  confirm,
  pending,
  onConfirm,
}: Readonly<{
  confirmation: Confirmation;
  title: string;
  body: ReactNode;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
}>) {
  const { control } = confirmation;
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
            aria-disabled={pending || undefined}
            onClick={(event) => {
              // The mutation closes the dialog once it knows the outcome.
              event.preventDefault();
              if (!pending) onConfirm();
            }}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
