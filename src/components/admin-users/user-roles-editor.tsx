// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useUsersMutation } from "@/components/admin-users/admin-action";
import { useAppForm } from "@/components/form/app-form";
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
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { roleLabel, rolesLabel } from "@/lib/i18n/labels";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import { ROLES, type Role, sortRoles } from "@/lib/roles";
import { setAdminUserRoles } from "@/server/users/functions";
import { actionErrorCode, setRolesMutationOptions } from "@/server/users/query-options";
import { userRolesFormSchema } from "@/server/users/schemas";

/**
 * Says whether `role` is ruled out by the roles already checked (ADR 0012): student goes with
 * no other role, so with student checked the others are greyed out, and the other way round.
 */
export function roleRuledOut(current: readonly Role[], role: Role): boolean {
  if (current.includes(role)) return false;
  return role === "student" ? current.length > 0 : current.includes("student");
}

/**
 * Returns the role set after `role` is checked or unchecked, kept inside the allowed sets
 * (ADR 0012): student excludes the other roles, so checking one clears the other side.
 */
export function toggleRole(current: readonly Role[], role: Role, checked: boolean): Role[] {
  if (!checked) return current.filter((held) => held !== role);
  if (role === "student") return ["student"];
  return sortRoles([...current.filter((held) => held !== "student"), role]);
}

/**
 * The role editor for a local role set (owner decision on #32): a checkbox per role,
 * constrained to the allowed sets, saved after an `AlertDialog` confirmation. A refusal from
 * the server is shown at the field until the next change.
 */
export function UserRolesEditor({
  userId,
  name,
  roles,
}: Readonly<{ userId: string; name: string; roles: readonly Role[] }>) {
  const [pending, setPending] = useState<Role[] | null>(null);
  const queryClient = useQueryClient();
  const callSave = useServerFn(setAdminUserRoles);
  const save = useUsersMutation(setRolesMutationOptions(queryClient, callSave), () =>
    m.admin_users_roles_saved({ name }),
  );
  const form = useAppForm({
    defaultValues: { roles: [...roles] },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: userRolesFormSchema },
    onSubmit: ({ value }) => setPending(value.roles),
  });

  // The saved set changes on an optimistic update, its rollback and a refetch. The form follows
  // it without validating, so a refusal the server just gave stays shown at the field.
  const saved = roles.join(",");
  useEffect(() => {
    const held = saved.split(",");
    form.setFieldValue(
      "roles",
      ROLES.filter((role) => held.includes(role)),
      { dontValidate: true, dontUpdateMeta: true },
    );
  }, [form, saved]);

  async function confirm(next: Role[]) {
    setPending(null);
    try {
      await save.mutateAsync({ userId, roles: next });
    } catch (error) {
      applyServerRefusal(form, {
        fields: { roles: adminActionErrorMessage(actionErrorCode(error)) },
      });
    }
  }

  return (
    <>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.AppField name="roles">
            {(field) => (
              <field.CheckboxGroupField
                label={m.admin_users_roles_edit()}
                description={m.admin_users_roles_edit_help()}
                options={ROLES.map((role) => ({
                  value: role,
                  label: roleLabel(role),
                  disabled: roleRuledOut(field.state.value, role),
                }))}
                toggle={toggleRole}
              />
            )}
          </form.AppField>
          <div>
            <form.SubmitButton
              size="sm"
              busy={save.isPending}
              icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}
            >
              {m.admin_users_roles_save()}
            </form.SubmitButton>
          </div>
        </form.AppForm>
      </form>
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.admin_users_roles_confirm_title({ name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_users_roles_confirm_body({ roles: rolesLabel(pending ?? []) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.admin_users_cancel()}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && void confirm(pending)}>
              {m.admin_users_roles_save()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
