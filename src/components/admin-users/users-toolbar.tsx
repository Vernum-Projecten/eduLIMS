// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";
import { type FormEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { m } from "@/i18n/messages";
import { roleLabel } from "@/lib/i18n/labels";
import { signInMethodLabel, userStatusLabel } from "@/lib/i18n/user-labels";
import { ROLES } from "@/lib/roles";
import type { SignInMethod } from "@/lib/sign-in-method";
import { USER_STATUSES, type UserListSearch } from "@/server/users/schemas";

/** Returns whether any search or filter narrows the list. */
export function hasFilters(search: UserListSearch): boolean {
  return Boolean(search.q || search.role || search.provider || search.status);
}

/**
 * The search and filters of the users table. Every change goes into the URL search params
 * (`tanstack.md`), which reload the page of users from the server.
 */
export function UsersToolbar({
  search,
  providerOptions,
}: Readonly<{ search: UserListSearch; providerOptions: readonly SignInMethod[] }>) {
  const navigate = useNavigate({ from: "/admin/users" });
  const id = useId();

  function update(patch: Partial<UserListSearch>) {
    void navigate({
      to: "/admin/users",
      search: (prev) => ({ ...prev, ...patch, page: undefined }),
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const q = typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
    update({ q });
  }

  return (
    <div className="flex flex-col gap-4">
      <search>
        <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field className="sm:max-w-sm">
            <FieldLabel htmlFor={`${id}-q`}>{m.admin_users_search_label()}</FieldLabel>
            <Input
              id={`${id}-q`}
              name="q"
              type="search"
              defaultValue={search.q ?? ""}
              key={search.q ?? ""}
              maxLength={100}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" variant="secondary" className="sm:w-auto">
            <SearchIcon aria-hidden="true" data-icon="inline-start" />
            {m.admin_users_search_submit()}
          </Button>
        </form>
      </search>
      <fieldset className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <legend className="sr-only">{m.admin_users_filters()}</legend>
        <Field className="sm:w-44">
          <FieldLabel htmlFor={`${id}-role`}>{m.admin_users_filter_role()}</FieldLabel>
          <NativeSelect
            id={`${id}-role`}
            value={search.role ?? ""}
            onChange={(e) => update({ role: ROLES.find((role) => role === e.target.value) })}
          >
            <NativeSelectOption value="">{m.admin_users_filter_any_role()}</NativeSelectOption>
            {ROLES.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {roleLabel(role)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="sm:w-52">
          <FieldLabel htmlFor={`${id}-provider`}>{m.admin_users_filter_provider()}</FieldLabel>
          <NativeSelect
            id={`${id}-provider`}
            value={search.provider ?? ""}
            onChange={(e) =>
              update({ provider: providerOptions.find((option) => option === e.target.value) })
            }
          >
            <NativeSelectOption value="">{m.admin_users_filter_any_provider()}</NativeSelectOption>
            {providerOptions.map((provider) => (
              <NativeSelectOption key={provider} value={provider}>
                {signInMethodLabel(provider)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="sm:w-48">
          <FieldLabel htmlFor={`${id}-status`}>{m.admin_users_filter_status()}</FieldLabel>
          <NativeSelect
            id={`${id}-status`}
            value={search.status ?? ""}
            onChange={(e) =>
              update({ status: USER_STATUSES.find((status) => status === e.target.value) })
            }
          >
            <NativeSelectOption value="">{m.admin_users_filter_any_status()}</NativeSelectOption>
            {USER_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {userStatusLabel(status)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {hasFilters(search) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              update({ q: undefined, role: undefined, provider: undefined, status: undefined })
            }
          >
            <XIcon aria-hidden="true" data-icon="inline-start" />
            {m.admin_users_clear_filters()}
          </Button>
        )}
      </fieldset>
    </div>
  );
}
