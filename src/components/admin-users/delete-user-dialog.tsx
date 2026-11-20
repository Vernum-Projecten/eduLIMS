// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useUsersMutation } from "@/components/admin-users/admin-action";
import { useAppForm } from "@/components/form/app-form";
import {
  AlertDialog,
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
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import { deleteAdminUser } from "@/server/users/functions";
import {
  actionErrorCode,
  deleteUserMutationOptions,
  forgetUser,
} from "@/server/users/query-options";

/**
 * Deletes one user from the detail sheet after a confirmation (#318, B1). A refusal, such as the
 * only teacher of a simulation, shows at the top of the dialog and takes focus (WCAG 3.3.1); the
 * dialog stays open. A deletion closes the dialog and the sheet and returns to the list.
 */
export function DeleteUserDialog({ userId, name }: Readonly<{ userId: string; name: string }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const call = useServerFn(deleteAdminUser);
  const deletion = useUsersMutation(deleteUserMutationOptions(queryClient, call), () =>
    m.admin_users_delete_done({ name }),
  );
  const form = useAppForm({
    defaultValues: {},
    onSubmit: async ({ formApi }) => {
      try {
        await deletion.mutateAsync({ userId });
      } catch (error) {
        applyServerRefusal(formApi, { form: adminActionErrorMessage(actionErrorCode(error)) });
        return;
      }
      setOpen(false);
      await navigate({ from: "/admin/users/$userId", to: "/admin/users", search: (prev) => prev });
      forgetUser(queryClient, userId);
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2Icon aria-hidden="true" data-icon="inline-start" />
          {m.admin_users_delete()}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <AlertDialogHeader>
              <AlertDialogTitle>{m.admin_users_delete_title({ name })}</AlertDialogTitle>
              <AlertDialogDescription>{m.admin_users_delete_description()}</AlertDialogDescription>
            </AlertDialogHeader>
            <form.FormErrors />
            <AlertDialogFooter className="-mx-4 -mb-4">
              <AlertDialogCancel type="button">{m.admin_users_cancel()}</AlertDialogCancel>
              <form.SubmitButton
                variant="destructive"
                icon={<Trash2Icon aria-hidden="true" data-icon="inline-start" />}
              >
                {m.admin_users_delete()}
              </form.SubmitButton>
            </AlertDialogFooter>
          </form.AppForm>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
