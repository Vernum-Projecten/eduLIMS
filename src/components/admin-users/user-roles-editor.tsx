// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useUsersMutation } from "@/components/admin-users/admin-action";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { roleLabel, rolesLabel } from "@/lib/i18n/labels";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import { ROLES, type Role, sortRoles } from "@/lib/roles";
import { setAdminUserRoles } from "@/server/users/functions";
import { actionErrorCode, setRolesMutationOptions } from "@/server/users/query-options";
import { userRolesFormSchema } from "@/server/users/schemas";

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
 * the server is shown at the field.
 */
export function UserRolesEditor({
  userId,
  name,
  roles,
}: Readonly<{ userId: string; name: string; roles: readonly Role[] }>) {
  const [pending, setPending] = useState<Role[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const callSave = useServerFn(setAdminUserRoles);
  const save = useUsersMutation(setRolesMutationOptions(queryClient, callSave), () =>
    m.admin_users_roles_saved({ name }),
  );
  const form = useForm({
    defaultValues: { roles: [...roles] },
    validators: { onSubmit: userRolesFormSchema },
    onSubmit: ({ value }) => {
      setServerError(null);
      setPending(value.roles);
    },
  });

  // The saved set changes on an optimistic update, its rollback and a refetch; the form follows
  // it without remounting, so a refusal stays shown at the field.
  const saved = roles.join(",");
  useEffect(() => {
    const held = saved.split(",");
    form.reset({ roles: ROLES.filter((role) => held.includes(role)) });
  }, [form, saved]);

  async function confirm(next: Role[]) {
    setPending(null);
    try {
      await save.mutateAsync({ userId, roles: next });
      setServerError(null);
    } catch (error) {
      setServerError(adminActionErrorMessage(actionErrorCode(error)));
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
        <form.Field name="roles">
          {(field) => {
            const isInvalid =
              serverError !== null || (field.state.meta.isTouched && !field.state.meta.isValid);
            return (
              <FieldSet data-invalid={isInvalid}>
                <FieldLegend variant="label">{m.admin_users_roles_edit()}</FieldLegend>
                <FieldDescription>{m.admin_users_roles_edit_help()}</FieldDescription>
                <div className="flex flex-col gap-2">
                  {ROLES.map((role) => {
                    const id = `role-${role}`;
                    return (
                      <Field key={role} orientation="horizontal" data-invalid={isInvalid}>
                        <Checkbox
                          id={id}
                          name={field.name}
                          checked={field.state.value.includes(role)}
                          onCheckedChange={(checked) => {
                            setServerError(null);
                            field.handleChange(
                              toggleRole(field.state.value, role, checked === true),
                            );
                          }}
                          onBlur={field.handleBlur}
                          aria-invalid={isInvalid}
                        />
                        <FieldLabel htmlFor={id} className="font-normal">
                          {roleLabel(role)}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </div>
                {field.state.meta.isTouched && !field.state.meta.isValid && (
                  <FieldError errors={field.state.meta.errors} />
                )}
                {serverError && <FieldError>{serverError}</FieldError>}
              </FieldSet>
            );
          }}
        </form.Field>
        <div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            <SaveIcon aria-hidden="true" data-icon="inline-start" />
            {m.admin_users_roles_save()}
          </Button>
        </div>
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
