// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import { actionErrorCode } from "@/server/users/query-options";

/**
 * Runs a Users-screen mutation from `src/server/users/query-options.ts` and announces its
 * outcome in a toast (a live region): `success` on success, the translated refusal on failure.
 * The options' own callbacks (the optimistic update, its rollback, the targeted invalidation)
 * run first.
 */
export function useUsersMutation<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  success: (data: TData, variables: TVariables) => string | null,
) {
  return useMutation({
    ...options,
    onSuccess: async (...args) => {
      await options.onSuccess?.(...args);
      const message = success(args[0], args[1]);
      if (message) toast.success(message);
    },
    onError: async (...args) => {
      await options.onError?.(...args);
      toast.error(adminActionErrorMessage(actionErrorCode(args[0])));
    },
  });
}

/** The content of a confirmation: its title, explanation and confirm button. */
export interface Confirmation {
  title: string;
  description: ReactNode;
  confirm: string;
}

/**
 * A controlled confirmation `AlertDialog` without a trigger, for an action started from a
 * menu. `onCloseAutoFocus` lets the opener return focus to its own trigger (WCAG 2.4.3).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  confirmation,
  onConfirm,
  onCloseAutoFocus,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmation: Confirmation;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.admin_users_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant="default"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmation.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A button that asks for confirmation in an `AlertDialog` before it runs `onConfirm`. */
export function ConfirmButton({
  icon: Icon,
  label,
  title,
  description,
  confirm,
  destructive = false,
  pending = false,
  size = "sm",
  onConfirm,
}: Readonly<{
  icon: LucideIcon;
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirm: string;
  destructive?: boolean;
  pending?: boolean;
  size?: "sm" | "default";
  onConfirm: () => void;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size={size} disabled={pending}>
          <Icon
            aria-hidden="true"
            data-icon="inline-start"
            className={destructive ? "text-destructive" : undefined}
          />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.admin_users_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant="default"
            onClick={() => {
              setOpen(false);
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
