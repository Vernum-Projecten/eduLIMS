// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { RoleBadges, StatusBadge } from "@/components/admin-users/user-badges";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import { signInMethodLabel } from "@/lib/i18n/user-labels";
import type { UserRow } from "@/server/users/queries";
import type { UserListSearch, UserSortField } from "@/server/users/schemas";

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, UserRow>();

const columns = helper.columns([
  helper.display({ id: "user", header: () => m.admin_users_col_user() }),
  helper.display({ id: "roles", header: () => m.admin_users_col_roles() }),
  helper.display({ id: "providers", header: () => m.admin_users_col_providers() }),
  helper.display({ id: "status", header: () => m.admin_users_col_status() }),
  helper.display({ id: "lastSignIn", header: () => m.admin_users_col_last_sign_in() }),
  helper.display({ id: "sessions", header: () => m.admin_users_col_sessions() }),
]);

const SORTABLE: Readonly<Record<string, UserSortField>> = {
  user: "name",
  lastSignIn: "lastSignIn",
};

/** The id of a user's name link, where focus returns when the detail sheet closes. */
export function userLinkId(userId: string): string {
  return `user-link-${userId}`;
}

function sortLabel(field: UserSortField): string {
  return field === "name" ? m.admin_users_col_user() : m.admin_users_col_last_sign_in();
}

function SortHeader({
  field,
  search,
  children,
}: Readonly<{ field: UserSortField; search: UserListSearch; children: ReactNode }>) {
  const active = (search.sort ?? "name") === field;
  const dir = search.dir ?? "asc";
  const next = active && dir === "asc" ? "desc" : "asc";
  const Icon = active ? (dir === "asc" ? ArrowUpIcon : ArrowDownIcon) : ArrowUpDownIcon;
  return (
    <Link
      to="/admin/users"
      search={(prev) => ({ ...prev, sort: field, dir: next, page: undefined })}
      className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={
        next === "asc"
          ? m.admin_users_sort_asc({ column: sortLabel(field) })
          : m.admin_users_sort_desc({ column: sortLabel(field) })
      }
    >
      {children}
      <Icon aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function ariaSort(field: UserSortField | undefined, search: UserListSearch) {
  if (!field || (search.sort ?? "name") !== field) return undefined;
  return search.dir === "desc" ? "descending" : "ascending";
}

function Cell({ row, column, readAt }: Readonly<{ row: UserRow; column: string; readAt: string }>) {
  switch (column) {
    case "user":
      return (
        <div className="flex min-w-48 flex-col">
          <Link
            id={userLinkId(row.id)}
            to="/admin/users/$userId"
            params={{ userId: row.id }}
            search={(prev) => prev}
            className="font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {row.name}
          </Link>
          <span className="text-muted-foreground">{row.email}</span>
        </div>
      );
    case "roles":
      return <RoleBadges roles={row.roles} source={row.roleSource} />;
    case "providers":
      return row.providers.length === 0 ? (
        <span className="text-muted-foreground">{m.admin_users_none()}</span>
      ) : (
        <ul>
          {row.providers.map((provider) => (
            <li key={provider}>{signInMethodLabel(provider)}</li>
          ))}
        </ul>
      );
    case "status":
      return <StatusBadge status={row.status} blockedUntil={row.blockedUntil} />;
    case "lastSignIn":
      return row.lastSignInAt ? (
        <div className="flex flex-col">
          <time dateTime={row.lastSignInAt}>{formatRelativeTime(row.lastSignInAt, readAt)}</time>
          <span className="text-muted-foreground">{formatDateTime(row.lastSignInAt)}</span>
        </div>
      ) : (
        <span className="text-muted-foreground">{m.admin_users_never()}</span>
      );
    case "sessions":
      return <span className="tabular-nums">{formatNumber(row.activeSessions)}</span>;
    default:
      return null;
  }
}

/**
 * The users table: TanStack Table v9 with the shadcn `Table`, one server-side page of rows.
 * Sorting and paging are links that change the URL search params; the server sorts.
 */
export function UsersTable({
  rows,
  readAt,
  search,
  caption,
}: Readonly<{ rows: UserRow[]; readAt: string; search: UserListSearch; caption: string }>) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id });
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const field = SORTABLE[header.column.id];
              return (
                <TableHead key={header.id} scope="col" aria-sort={ariaSort(field, search)}>
                  {field ? (
                    <SortHeader field={field} search={search}>
                      <table.FlexRender header={header} />
                    </SortHeader>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className="align-top">
                <Cell row={row.original} column={cell.column.id} readAt={readAt} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The loading state of the users table: its header and skeleton rows. */
export function UsersTableSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only" role="status">
        {m.loading()}
      </span>
      {Array.from({ length: 6 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity.
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
