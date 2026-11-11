// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BanIcon, EyeIcon, LockOpenIcon, LogOutIcon } from "lucide-react";
import { useContext, useRef, useState } from "react";
import { ConfirmDialog, useUsersMutation } from "@/components/admin-users/admin-action";
import { BlockUserDialog } from "@/components/admin-users/block-user-dialog";
import { UsersTableContext } from "@/components/admin-users/users-table-context";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";
import { endAllAdminUserSessions, unblockAdminUser } from "@/server/users/functions";
import type { UserRow } from "@/server/users/queries";
import {
  endAllSessionsMutationOptions,
  unblockUserMutationOptions,
} from "@/server/users/query-options";

type OpenDialog = "end-sessions" | "block" | "unblock" | null;

/**
 * The row menu of the users table (#58): view details, end all sessions, and block or unblock,
 * each confirmed in the same dialogs as the detail sheet. The administrator's own row offers
 * only the details: blocking oneself is refused, and ending one's sessions lives in the sheet.
 */
export function UserRowActions({ user }: Readonly<{ user: UserRow }>) {
  const { selfId } = useContext(UsersTableContext);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const queryClient = useQueryClient();
  const callEndAll = useServerFn(endAllAdminUserSessions);
  const callUnblock = useServerFn(unblockAdminUser);
  const endAll = useUsersMutation(endAllSessionsMutationOptions(queryClient, callEndAll), () =>
    m.admin_users_sessions_ended({ name: user.name }),
  );
  const unblock = useUsersMutation(unblockUserMutationOptions(queryClient, callUnblock), () =>
    m.admin_users_unblock_done({ name: user.name }),
  );
  const self = user.id === selfId;
  const blocked = user.status === "blocked";

  function returnFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  function control(name: Exclude<OpenDialog, null>) {
    return {
      open: dialog === name,
      onOpenChange: (open: boolean) => setDialog(open ? name : null),
      onCloseAutoFocus: returnFocus,
    };
  }

  return (
    <>
      <DataTableRowActions
        label={m.data_table_row_actions({ name: user.name })}
        triggerRef={triggerRef}
      >
        <DropdownMenuItem asChild>
          <Link to="/admin/users/$userId" params={{ userId: user.id }} search={(prev) => prev}>
            <EyeIcon aria-hidden="true" />
            {m.admin_users_view_details()}
          </Link>
        </DropdownMenuItem>
        {!self && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={user.activeSessions === 0 || endAll.isPending}
              onSelect={() => setDialog("end-sessions")}
            >
              <LogOutIcon aria-hidden="true" />
              {m.admin_users_end_all_sessions()}
            </DropdownMenuItem>
            {blocked ? (
              <DropdownMenuItem disabled={unblock.isPending} onSelect={() => setDialog("unblock")}>
                <LockOpenIcon aria-hidden="true" />
                {m.admin_users_unblock()}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("block")}>
                <BanIcon aria-hidden="true" />
                {m.admin_users_block()}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DataTableRowActions>
      <ConfirmDialog
        {...control("end-sessions")}
        confirmation={{
          title: m.admin_users_end_all_sessions(),
          description: m.admin_users_end_all_sessions_body({ name: user.name }),
          confirm: m.admin_users_end_all_sessions(),
        }}
        onConfirm={() => endAll.mutate({ userId: user.id })}
      />
      <ConfirmDialog
        {...control("unblock")}
        confirmation={{
          title: m.admin_users_unblock_title({ name: user.name }),
          description: m.admin_users_unblock_body(),
          confirm: m.admin_users_unblock(),
        }}
        onConfirm={() => unblock.mutate({ userId: user.id })}
      />
      <BlockUserDialog userId={user.id} name={user.name} control={control("block")} />
    </>
  );
}
