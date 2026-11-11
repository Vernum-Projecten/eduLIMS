// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { USER_PAGE_SIZES } from "@/server/users/schemas";

/** Returns how many pages `total` rows fill at `size` per page; at least one. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The pagination of the users table: the range shown, previous and next, and the page size. */
export function UsersPagination({
  total,
  page,
  size,
}: Readonly<{ total: number; page: number; size: number }>) {
  const navigate = useNavigate({ from: "/admin/users" });
  const id = useId();
  const pages = pageCount(total, size);
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <nav
      aria-label={m.admin_users_pagination()}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground">
        {m.admin_users_range({
          first: formatNumber(first),
          last: formatNumber(last),
          total: formatNumber(total),
        })}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel htmlFor={`${id}-size`} className="whitespace-nowrap">
            {m.admin_users_page_size()}
          </FieldLabel>
          <NativeSelect
            id={`${id}-size`}
            value={String(size)}
            onChange={(e) => {
              const next = USER_PAGE_SIZES.find((option) => String(option) === e.target.value);
              void navigate({
                to: "/admin/users",
                search: (prev) => ({ ...prev, size: next, page: undefined }),
              });
            }}
          >
            {USER_PAGE_SIZES.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {formatNumber(option)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <span className="text-sm tabular-nums">
          {m.admin_users_page_of({ page: formatNumber(page), pages: formatNumber(pages) })}
        </span>
        <div className="flex gap-2">
          <PageLink page={page - 1} disabled={page <= 1} label={m.admin_users_page_previous()}>
            <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
          </PageLink>
          <PageLink page={page + 1} disabled={page >= pages} label={m.admin_users_page_next()} end>
            <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
          </PageLink>
        </div>
      </div>
    </nav>
  );
}

function PageLink({
  page,
  disabled,
  label,
  end = false,
  children,
}: Readonly<{
  page: number;
  disabled: boolean;
  label: string;
  end?: boolean;
  children: ReactNode;
}>) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {!end && children}
        {label}
        {end && children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to="/admin/users" search={(prev) => ({ ...prev, page: page > 1 ? page : undefined })}>
        {!end && children}
        {label}
        {end && children}
      </Link>
    </Button>
  );
}
