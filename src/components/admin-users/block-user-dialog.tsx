// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BanIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { dayIn } from "@/lib/app-day";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import { blockAdminUser } from "@/server/users/functions";
import { actionErrorCode, blockUserMutationOptions } from "@/server/users/query-options";
import {
  BLOCK_REASON_MAX_LENGTH,
  type BlockUserForm,
  blockUserFormSchema,
} from "@/server/users/schemas";

const ONE_DAY_MS = 86_400_000;

/** Where a block dialog opens from: its own trigger, or a parent that controls it. */
export type DialogControl =
  | { trigger: ReactNode }
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onCloseAutoFocus?: (event: Event) => void;
    };

/**
 * The block form (owner decision on #32) in an `AlertDialog`: the reason and an optional last
 * day, confirming that the users are signed out and refused at every sign-in. The dialog
 * closes when `onBlock` resolves; when it rejects, the translated refusal shows at the top of
 * the form and takes focus (WCAG 3.3.1).
 */
export function BlockDialog({
  title,
  description,
  control,
  onBlock,
}: Readonly<{
  title: string;
  description: ReactNode;
  control: DialogControl;
  onBlock: (value: BlockUserForm) => Promise<unknown>;
}>) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = "open" in control;
  const open = controlled ? control.open : ownOpen;
  const setOpen = controlled ? control.onOpenChange : setOwnOpen;
  const form = useAppForm({
    defaultValues: { reason: "", until: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: blockUserFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await onBlock(value);
      } catch (error) {
        applyServerRefusal(formApi, { form: adminActionErrorMessage(actionErrorCode(error)) });
        return;
      }
      setOpen(false);
      formApi.reset();
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {!controlled && <AlertDialogTrigger asChild>{control.trigger}</AlertDialogTrigger>}
      <AlertDialogContent
        className="data-[size=default]:sm:max-w-md"
        onCloseAutoFocus={controlled ? control.onCloseAutoFocus : undefined}
      >
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
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="reason">
                {(field) => (
                  <field.TextareaField
                    label={m.admin_users_block_reason()}
                    description={m.admin_users_block_reason_help()}
                    maxLength={BLOCK_REASON_MAX_LENGTH}
                    rows={3}
                  />
                )}
              </form.AppField>
              <form.AppField name="until">
                {(field) => (
                  <field.DateField
                    label={m.admin_users_block_until()}
                    description={m.admin_users_block_until_help()}
                    emptyLabel={m.admin_users_block_until_none()}
                    clearLabel={m.admin_users_block_until_clear()}
                    minDay={dayIn(new Date(Date.now() + ONE_DAY_MS))}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <AlertDialogFooter className="-mx-4 -mb-4">
              <AlertDialogCancel type="button">{m.admin_users_cancel()}</AlertDialogCancel>
              <form.SubmitButton
                variant="destructive"
                icon={<BanIcon aria-hidden="true" data-icon="inline-start" />}
              >
                {m.admin_users_block_confirm()}
              </form.SubmitButton>
            </AlertDialogFooter>
          </form.AppForm>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Returns the trigger of the block dialog in the user detail sheet (an element Radix can slot). */
function blockUserTrigger() {
  return (
    <Button variant="destructive" size="sm">
      <BanIcon aria-hidden="true" data-icon="inline-start" />
      {m.admin_users_block()}
    </Button>
  );
}

/** Blocks one user, from the detail sheet (its own trigger) or a row menu (`control`). */
export function BlockUserDialog({
  userId,
  name,
  control = { trigger: blockUserTrigger() },
}: Readonly<{ userId: string; name: string; control?: DialogControl }>) {
  const queryClient = useQueryClient();
  const call = useServerFn(blockAdminUser);
  const block = useUsersMutation(blockUserMutationOptions(queryClient, call), () =>
    m.admin_users_block_done({ name }),
  );
  return (
    <BlockDialog
      title={m.admin_users_block_title({ name })}
      description={m.admin_users_block_description()}
      control={control}
      onBlock={(value) => block.mutateAsync({ userId, ...value })}
    />
  );
}
