// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BanIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, useUsersMutation } from "@/components/admin-users/admin-action";
import { BlockDialog } from "@/components/admin-users/block-user-dialog";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { adminActionErrorMessage } from "@/lib/i18n/user-labels";
import type { BulkActionResult } from "@/server/users/actions";
import { bulkBlockAdminUsers, bulkEndAdminUserSessions } from "@/server/users/functions";
import {
  bulkBlockMutationOptions,
  bulkEndSessionsMutationOptions,
} from "@/server/users/query-options";

/** Announces the users a bulk action skipped, with the reason of the first refusal. */
function announceRefusals(result: BulkActionResult): void {
  const first = result.refused.at(0);
  if (!first) return;
  toast.error(
    m.admin_users_bulk_refused({
      count: formatNumber(result.refused.length),
      reason: adminActionErrorMessage(first.error),
    }),
  );
}

/**
 * The bulk actions of the users table (#58): end the sessions of, or block, the selected users
 * after a confirmation. The server runs the single-user action per user, so each gets its own
 * refusal and activity-log row; `onDone` clears the selection.
 */
export function UsersBulkActions({
  userIds,
  onDone,
}: Readonly<{ userIds: readonly string[]; onDone: () => void }>) {
  const [dialog, setDialog] = useState<"end-sessions" | "block" | null>(null);
  const queryClient = useQueryClient();
  const callEnd = useServerFn(bulkEndAdminUserSessions);
  const callBlock = useServerFn(bulkBlockAdminUsers);
  const endSessions = useUsersMutation(
    bulkEndSessionsMutationOptions(queryClient, callEnd),
    (result) => {
      announceRefusals(result);
      return result.done.length > 0
        ? m.admin_users_bulk_sessions_ended({ count: formatNumber(result.done.length) })
        : null;
    },
  );
  const block = useUsersMutation(bulkBlockMutationOptions(queryClient, callBlock), (result) => {
    announceRefusals(result);
    return result.done.length > 0
      ? m.admin_users_bulk_blocked({ count: formatNumber(result.done.length) })
      : null;
  });
  const count = formatNumber(userIds.length);
  const pending = endSessions.isPending || block.isPending;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setDialog("end-sessions")}
      >
        <LogOutIcon aria-hidden="true" data-icon="inline-start" />
        {m.admin_users_bulk_end_sessions()}
      </Button>
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => setDialog("block")}>
        <BanIcon aria-hidden="true" data-icon="inline-start" />
        {m.admin_users_bulk_block()}
      </Button>
      <ConfirmDialog
        open={dialog === "end-sessions"}
        onOpenChange={(open) => setDialog(open ? "end-sessions" : null)}
        confirmation={{
          title: m.admin_users_bulk_end_sessions_title(),
          description: m.admin_users_bulk_end_sessions_body({ count }),
          confirm: m.admin_users_end_all_sessions(),
        }}
        onConfirm={() => endSessions.mutate({ userIds: [...userIds] }, { onSuccess: onDone })}
      />
      <BlockDialog
        title={m.admin_users_bulk_block_title()}
        description={
          <>
            {m.admin_users_bulk_selected({ count })} {m.admin_users_block_description()}
          </>
        }
        control={{
          open: dialog === "block",
          onOpenChange: (open) => setDialog(open ? "block" : null),
        }}
        onBlock={(value) =>
          block.mutateAsync({ userIds: [...userIds], ...value }).then(
            () => {
              onDone();
              return true;
            },
            () => false,
          )
        }
      />
    </>
  );
}
