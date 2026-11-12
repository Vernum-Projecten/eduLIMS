// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { useContext } from "react";
import { useProviderLabels } from "@/components/admin-users/provider-labels";
import { ProvisioningText, RoleBadges, StatusBadge } from "@/components/admin-users/user-badges";
import { UserRowActions } from "@/components/admin-users/user-row-actions";
import { UsersTableContext } from "@/components/admin-users/users-table-context";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { selectionColumn } from "@/components/data-table/data-table-selection";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { m } from "@/i18n/messages";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import { signInMethodLabel } from "@/lib/i18n/user-labels";
import type { SignInMethod } from "@/lib/sign-in-method";
import type { UserRow } from "@/server/users/queries";

/** The id of a user's name link, where focus returns when the detail sheet closes. */
export function userLinkId(userId: string): string {
  return `user-link-${userId}`;
}

function NameCell({ row }: Readonly<{ row: UserRow }>) {
  return (
    <div className="flex min-w-48 flex-col">
      <Link
        id={userLinkId(row.id)}
        from="/admin/users"
        to="/admin/users/$userId"
        params={{ userId: row.id }}
        search={(prev) => prev}
        className="w-fit font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {row.name}
      </Link>
      <span className="text-muted-foreground">{row.email}</span>
      <ProvisioningText provisioning={row.provisioning} />
    </div>
  );
}

function LastSignInCell({ value }: Readonly<{ value: string | null }>) {
  const { readAt } = useContext(UsersTableContext);
  if (!value) return <span className="text-muted-foreground">{m.admin_users_never()}</span>;
  return (
    <div className="flex flex-col whitespace-nowrap">
      <time dateTime={value}>{formatRelativeTime(value, readAt)}</time>
      <span className="text-muted-foreground">{formatDateTime(value)}</span>
    </div>
  );
}

const helper = createDataTableColumnHelper<UserRow>();

/** The columns of the users table (#34, #58); each owns its header and cell. */
export const usersColumns = helper.columns([
  selectionColumn<UserRow>((row) => row.name),
  helper.accessor("name", {
    id: "name",
    meta: { label: () => m.admin_users_col_user() },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <NameCell row={row.original} />,
  }),
  helper.accessor("roles", {
    id: "roles",
    meta: { label: () => m.admin_users_col_roles() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <RoleBadges roles={row.original.roles} source={row.original.roleSource} />,
  }),
  helper.accessor("providers", {
    id: "providers",
    meta: { label: () => m.admin_users_col_providers() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) =>
      row.original.providers.length === 0 ? (
        <span className="text-muted-foreground">{m.admin_users_none()}</span>
      ) : (
        <ProviderList providers={row.original.providers} />
      ),
  }),
  helper.accessor("status", {
    id: "status",
    meta: { label: () => m.admin_users_col_status() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} blockedUntil={row.original.blockedUntil} />
    ),
  }),
  helper.accessor("lastSignInAt", {
    id: "lastSignIn",
    meta: { label: () => m.admin_users_col_last_sign_in() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <LastSignInCell value={row.original.lastSignInAt} />,
  }),
  helper.accessor("activeSessions", {
    id: "sessions",
    meta: { label: () => m.admin_users_col_sessions(), className: "text-right" },
    enableSorting: false,
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatNumber(row.original.activeSessions)}</span>
    ),
  }),
  helper.display({
    id: "actions",
    enableHiding: false,
    meta: { label: () => m.data_table_actions(), className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <UserRowActions user={row.original} />,
  }),
]);

/** The sign-in methods of a user, by the providers' names. */
function ProviderList({ providers }: Readonly<{ providers: readonly SignInMethod[] }>) {
  const labels = useProviderLabels();
  return (
    <ul className="whitespace-nowrap">
      {providers.map((provider) => (
        <li key={provider}>{signInMethodLabel(provider, labels)}</li>
      ))}
    </ul>
  );
}
