// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LockOpenIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ConfirmButton, useUsersMutation } from "@/components/admin-users/admin-action";
import { BlockUserDialog } from "@/components/admin-users/block-user-dialog";
import { RoleBadges, RoleSourceText, StatusBadge } from "@/components/admin-users/user-badges";
import { UserRolesEditor } from "@/components/admin-users/user-roles-editor";
import { UserSessions } from "@/components/admin-users/user-sessions";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { m } from "@/i18n/messages";
import { formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import { roleLabel } from "@/lib/i18n/labels";
import {
  auditActionLabel,
  auditActorLabel,
  auditOutcomeLabel,
  languageLabel,
  roleSourceLabel,
  signInMethodLabel,
} from "@/lib/i18n/user-labels";
import type { UserDetail } from "@/server/users/detail";
import { unblockAdminUser } from "@/server/users/functions";
import { unblockUserMutationOptions } from "@/server/users/query-options";

/** Returns up to two initials of a name, for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0)?.at(0) ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.at(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function Section({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Detail({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function rolesExplanation(user: UserDetail): string {
  if (user.self) return m.admin_users_roles_own();
  if (user.rolesEditable) return m.admin_users_roles_local_help();
  return m.admin_users_roles_idp_help({ source: roleSourceLabel(user.roleSource) });
}

/**
 * The content of the user detail sheet (#34): its header and one section per topic. While
 * `updating` (a background refetch after an action), "Updating…" shows in the header.
 */
export function UserDetailContent({
  user,
  updating = false,
}: Readonly<{ user: UserDetail; updating?: boolean }>) {
  const queryClient = useQueryClient();
  const callUnblock = useServerFn(unblockAdminUser);
  const unblock = useUsersMutation(unblockUserMutationOptions(queryClient, callUnblock), () =>
    m.admin_users_unblock_done({ name: user.name }),
  );
  return (
    <>
      <SheetHeader
        aria-busy={updating || undefined}
        className="flex-row items-center gap-3 border-b pr-28"
      >
        <UpdatingIndicator active={updating} className="top-11 right-3" />
        <Avatar size="lg">
          <AvatarFallback aria-hidden="true" className="text-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <SheetTitle className="truncate">{user.name}</SheetTitle>
          <SheetDescription className="truncate">{user.email}</SheetDescription>
        </div>
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
            <XIcon aria-hidden="true" />
            <span className="sr-only">{m.admin_users_close_detail()}</span>
          </Button>
        </SheetClose>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-6">
        <Section id="user-profile" title={m.admin_users_section_profile()}>
          <dl className="flex flex-col gap-2">
            <Detail term={m.admin_users_status()}>
              <StatusBadge status={user.status} blockedUntil={user.block?.until ?? null} />
            </Detail>
            <Detail term={m.admin_users_created()}>{formatDateTime(user.createdAt)}</Detail>
            <Detail term={m.admin_users_col_last_sign_in()}>
              {user.lastSignInAt ? (
                <>
                  <time dateTime={user.lastSignInAt}>
                    {formatRelativeTime(user.lastSignInAt, user.readAt)}
                  </time>{" "}
                  ({formatDateTime(user.lastSignInAt)})
                  {user.lastSignInMethod && (
                    <span className="block text-muted-foreground">
                      {m.admin_users_last_method({
                        method: signInMethodLabel(user.lastSignInMethod),
                      })}
                    </span>
                  )}
                </>
              ) : (
                m.admin_users_never()
              )}
            </Detail>
            <Detail term={m.admin_users_language()}>
              {user.locale ? languageLabel(user.locale) : m.admin_users_not_set()}
            </Detail>
            <Detail term={m.admin_users_portal()}>
              {user.lastPortal ? roleLabel(user.lastPortal) : m.admin_users_not_set()}
            </Detail>
          </dl>
        </Section>
        <Separator />
        <Section id="user-roles" title={m.admin_users_col_roles()}>
          <RoleBadges roles={user.roles} source={user.roleSource} />
          <div className="flex flex-col gap-1 text-muted-foreground">
            <RoleSourceText source={user.roleSource} />
            <p>{rolesExplanation(user)}</p>
          </div>
          {user.rolesEditable && (
            <UserRolesEditor key={user.id} userId={user.id} name={user.name} roles={user.roles} />
          )}
        </Section>
        <Separator />
        <Section id="user-block" title={m.admin_users_section_block()}>
          {user.block ? (
            <>
              <dl className="flex flex-col gap-2">
                <Detail term={m.admin_users_block_reason()}>
                  {user.block.reason ?? m.admin_users_not_set()}
                </Detail>
                <Detail term={m.admin_users_blocked_until()}>
                  {user.block.until
                    ? formatDateTime(user.block.until)
                    : m.admin_users_blocked_indefinitely()}
                </Detail>
              </dl>
              <div>
                <ConfirmButton
                  icon={LockOpenIcon}
                  label={m.admin_users_unblock()}
                  title={m.admin_users_unblock_title({ name: user.name })}
                  description={m.admin_users_unblock_body()}
                  confirm={m.admin_users_unblock()}
                  pending={unblock.isPending}
                  onConfirm={() => unblock.mutate({ userId: user.id })}
                />
              </div>
            </>
          ) : user.self ? (
            <p className="text-muted-foreground">{m.admin_users_error_block_self()}</p>
          ) : (
            <>
              <p className="text-muted-foreground">{m.admin_users_block_help()}</p>
              <div>
                <BlockUserDialog userId={user.id} name={user.name} />
              </div>
            </>
          )}
        </Section>
        <Separator />
        <Section id="user-sessions" title={m.admin_users_section_sessions()}>
          <UserSessions
            userId={user.id}
            name={user.name}
            self={user.self}
            sessions={user.sessions}
          />
        </Section>
        <Separator />
        <Section id="user-accounts" title={m.admin_users_section_accounts()}>
          {user.accounts.length === 0 ? (
            <p className="text-muted-foreground">{m.admin_users_none()}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {user.accounts.map((account) => (
                <li key={account.id}>
                  <span className="font-medium">
                    {account.provider
                      ? signInMethodLabel(account.provider)
                      : m.role_source_unknown()}
                  </span>{" "}
                  <code className="text-muted-foreground">{account.accountIdShort}</code>{" "}
                  <span className="text-muted-foreground">
                    {m.admin_users_linked({ date: formatDateTime(account.linkedAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Separator />
        <Section id="user-activity" title={m.admin_users_section_activity()}>
          {user.activity.length === 0 ? (
            <p className="text-muted-foreground">{m.admin_users_no_activity()}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {user.activity.map((event) => (
                <li key={event.id} className="flex flex-col">
                  <span>
                    <span className="font-medium">{auditActionLabel(event.action)}</span>
                    {" · "}
                    {auditOutcomeLabel(event.outcome)}
                    {" · "}
                    {auditActorLabel(event.actor)}
                  </span>
                  <time dateTime={event.occurredAt} className="text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {/* TODO(#36): link to this user's entries in the full activity log. */}
        </Section>
      </div>
    </>
  );
}
