// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import type { AdminActionResult } from "@/server/users/actions";
import { ADMIN_USERS_KEY } from "@/server/users/query-options";

type ActionFn<TInput> = (options: { data: TInput }) => Promise<AdminActionResult>;

/**
 * Runs an admin action of the user detail sheet: calls the server function, announces the
 * outcome in a toast (a live region), and reloads the Users screen's queries.
 */
export function useAdminAction<TInput>(action: ActionFn<TInput>, success: () => string) {
  const call = useServerFn(action);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TInput) => call({ data }),
    onSuccess: async (result) => {
      if (result.ok) toast.success(success());
      else toast.error(adminActionErrorMessage(result.error));
      await queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
    onError: () => {
      toast.error(m.admin_users_error_failed());
    },
  });
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
