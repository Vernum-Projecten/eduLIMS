// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { LogOutIcon, MonitorSmartphoneIcon } from "lucide-react";
import { ConfirmButton, useAdminAction } from "@/components/admin-users/admin-action";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import type { DeviceSummary } from "@/lib/user-agent";
import type { UserSession } from "@/server/users/detail";
import { endAdminUserSession, endAllAdminUserSessions } from "@/server/users/functions";

function deviceLabel(device: DeviceSummary): string {
  if (device.browser && device.os)
    return m.admin_users_device({ browser: device.browser, os: device.os });
  return device.browser ?? device.os ?? m.admin_users_device_unknown();
}

/**
 * The live sessions of a user, each with "End session", and "End all sessions". On the
 * administrator's own account the current session cannot be ended here and "End all" ends the
 * others.
 */
export function UserSessions({
  userId,
  name,
  self,
  sessions,
}: Readonly<{ userId: string; name: string; self: boolean; sessions: UserSession[] }>) {
  const endOne = useAdminAction(endAdminUserSession, () => m.admin_users_session_ended());
  const endAll = useAdminAction(endAllAdminUserSessions, () =>
    self ? m.admin_users_other_sessions_ended() : m.admin_users_sessions_ended({ name }),
  );
  const endable = sessions.filter((session) => !session.current).length;

  if (sessions.length === 0) {
    return <p className="text-muted-foreground">{m.admin_users_no_sessions()}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => {
          const device = deviceLabel(session.device);
          return (
            <li
              key={session.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 gap-2">
                <MonitorSmartphoneIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    {device}
                    {session.current && (
                      <Badge variant="outline" className="ml-2">
                        {m.admin_users_session_current()}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {m.admin_users_session_started({ date: formatDateTime(session.createdAt) })}
                  </span>
                  <span className="text-muted-foreground">
                    {m.admin_users_session_expires({ date: formatDateTime(session.expiresAt) })}
                  </span>
                </div>
              </div>
              {!session.current && (
                <ConfirmButton
                  icon={LogOutIcon}
                  label={
                    <>
                      {m.admin_users_end_session()}
                      <span className="sr-only">
                        {" "}
                        {m.admin_users_end_session_of({
                          device,
                          date: formatDateTime(session.createdAt),
                        })}
                      </span>
                    </>
                  }
                  title={m.admin_users_end_session_title()}
                  description={m.admin_users_end_session_body({ name, device })}
                  confirm={m.admin_users_end_session()}
                  destructive
                  pending={endOne.isPending}
                  onConfirm={() => endOne.mutate({ userId, sessionId: session.id })}
                />
              )}
            </li>
          );
        })}
      </ul>
      {endable > 0 && (
        <div>
          <ConfirmButton
            icon={LogOutIcon}
            label={self ? m.admin_users_end_other_sessions() : m.admin_users_end_all_sessions()}
            title={self ? m.admin_users_end_other_sessions() : m.admin_users_end_all_sessions()}
            description={
              self
                ? m.admin_users_end_other_sessions_body()
                : m.admin_users_end_all_sessions_body({ name })
            }
            confirm={self ? m.admin_users_end_other_sessions() : m.admin_users_end_all_sessions()}
            destructive
            pending={endAll.isPending}
            onConfirm={() => endAll.mutate({ userId })}
          />
        </div>
      )}
    </div>
  );
}
