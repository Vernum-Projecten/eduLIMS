// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  BanIcon,
  BuildingIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  type LucideIcon,
  ServerIcon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { roleLabel } from "@/lib/i18n/labels";
import { roleSourceLabel, type UserStatusValue, userStatusLabel } from "@/lib/i18n/user-labels";
import type { RoleSource } from "@/lib/role-source";
import type { Role } from "@/lib/roles";

const SOURCE_ICONS: Record<RoleSource, LucideIcon> = {
  local: ServerIcon,
  microsoft: BuildingIcon,
  keycloak: KeyRoundIcon,
};

/**
 * The role badges of a user, each with the icon and the name of where the set comes from
 * (owner decision on #32), so the source never depends on the icon alone (WCAG 1.4.1).
 */
export function RoleBadges({
  roles,
  source,
}: Readonly<{ roles: readonly Role[]; source: RoleSource | null }>) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground">{m.admin_users_no_roles()}</span>;
  }
  const Icon = source ? SOURCE_ICONS[source] : UserRoundIcon;
  const from = m.admin_users_role_from({ source: roleSourceLabel(source) });
  return (
    <ul
      className="flex flex-wrap gap-1"
      aria-label={m.admin_users_roles_list({ source: roleSourceLabel(source) })}
    >
      {roles.map((role) => (
        <li key={role}>
          <Badge variant="secondary" title={from}>
            <Icon aria-hidden="true" data-icon="inline-start" />
            {roleLabel(role)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** The role source as text with its icon, for the detail sheet. */
export function RoleSourceText({ source }: Readonly<{ source: RoleSource | null }>) {
  const Icon = source ? SOURCE_ICONS[source] : UserRoundIcon;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {m.admin_users_role_from({ source: roleSourceLabel(source) })}
    </span>
  );
}

/** The icon of each user status, beside its text (WCAG 1.4.1). */
export const STATUS_ICONS: Record<UserStatusValue, LucideIcon> = {
  active: CircleCheckIcon,
  blocked: BanIcon,
  never: CircleDashedIcon,
};

/** A user's status as a badge with an icon and text (WCAG 1.4.1). */
export function StatusBadge({
  status,
  blockedUntil,
}: Readonly<{ status: UserStatusValue; blockedUntil: string | null }>) {
  const Icon = STATUS_ICONS[status];
  const label =
    status === "blocked" && blockedUntil
      ? m.admin_users_status_blocked_until({ date: formatDateTime(blockedUntil) })
      : userStatusLabel(status);
  return (
    <Badge
      variant={status === "never" ? "secondary" : "outline"}
      className={status === "blocked" ? "border-destructive/60" : undefined}
    >
      <Icon
        aria-hidden="true"
        data-icon="inline-start"
        className={status === "blocked" ? "text-destructive" : undefined}
      />
      {label}
    </Badge>
  );
}
