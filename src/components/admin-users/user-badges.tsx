// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderSyncIcon,
  KeyRoundIcon,
  type LucideIcon,
  ServerIcon,
  UserRoundIcon,
  UserXIcon,
} from "lucide-react";
import { useProviderLabels } from "@/components/admin-users/provider-labels";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { roleLabel } from "@/lib/i18n/labels";
import { roleSourceLabel, type UserStatusValue, userStatusLabel } from "@/lib/i18n/user-labels";
import { LOCAL_ROLE_SOURCE, type RoleSource } from "@/lib/role-source";
import type { Role } from "@/lib/roles";
import type { Provisioning } from "@/server/users/queries";

/** The icon of a role source: eduLIMS itself, an identity provider, or unknown. */
function sourceIcon(source: RoleSource | null): LucideIcon {
  if (source === null) return UserRoundIcon;
  return source === LOCAL_ROLE_SOURCE ? ServerIcon : KeyRoundIcon;
}

/**
 * The role badges of a user, each with the icon and the name of where the set comes from
 * (owner decision on #32), so the source never depends on the icon alone (WCAG 1.4.1).
 */
export function RoleBadges({
  roles,
  source,
}: Readonly<{ roles: readonly Role[]; source: RoleSource | null }>) {
  const labels = useProviderLabels();
  if (roles.length === 0) {
    return <span className="text-muted-foreground">{m.admin_users_no_roles()}</span>;
  }
  const Icon = sourceIcon(source);
  const from = m.admin_users_role_from({ source: roleSourceLabel(source, labels) });
  return (
    <ul
      className="flex flex-wrap gap-1"
      aria-label={m.admin_users_roles_list({ source: roleSourceLabel(source, labels) })}
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
  const labels = useProviderLabels();
  const Icon = sourceIcon(source);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {m.admin_users_role_from({ source: roleSourceLabel(source, labels) })}
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
      variant={status === "blocked" ? "destructive" : status === "never" ? "secondary" : "outline"}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Badge>
  );
}

/**
 * Who provisioned a user over SCIM (#45), as text with an icon, and whether the directory has
 * deactivated them: "Provisioned by …" and, when it applies, "Deactivated by the directory".
 */
export function ProvisioningText({
  provisioning,
}: Readonly<{ provisioning: Provisioning | null }>) {
  const labels = useProviderLabels();
  if (!provisioning) return null;
  const source = labels[provisioning.providerId] ?? provisioning.providerId;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
      <FolderSyncIcon aria-hidden="true" className="size-4" />
      {m.admin_users_provisioned_by({ source })}
      {provisioning.deprovisionedAt && (
        <Badge variant="destructive">
          <UserXIcon aria-hidden="true" data-icon="inline-start" />
          {m.admin_users_deprovisioned()}
        </Badge>
      )}
    </span>
  );
}
