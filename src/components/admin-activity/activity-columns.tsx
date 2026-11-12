// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { BanIcon, CircleCheckIcon, CircleXIcon, type LucideIcon } from "lucide-react";
import { useProviderLabels } from "@/components/admin-users/provider-labels";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import {
  type ActivityObjectTarget,
  activityDetails,
  activityNonUserActorLabel,
  activityOutcomeLabel,
  activityTargetLabel,
} from "@/lib/i18n/activity-labels";
import { formatDateTime } from "@/lib/i18n/format";
import { auditActionLabel } from "@/lib/i18n/user-labels";
import type { ActivityRow, ActivityUser } from "@/server/activity/queries";
import type { AuditOutcome } from "@/server/audit/events";

/** The icon of each outcome, beside its text (WCAG 1.4.1). */
export const OUTCOME_ICONS: Record<AuditOutcome, LucideIcon> = {
  success: CircleCheckIcon,
  failure: CircleXIcon,
  refused: BanIcon,
};

const OUTCOME_VARIANTS = {
  success: "secondary",
  failure: "destructive",
  refused: "outline",
} as const satisfies Record<AuditOutcome, string>;

/** A user an event names: a link to their detail sheet, or "Deleted user" once they are gone. */
function UserCell({ user }: Readonly<{ user: ActivityUser }>) {
  if (user.name === null) {
    return <span className="text-muted-foreground">{m.admin_activity_user_deleted()}</span>;
  }
  return (
    <Link
      to="/admin/users/$userId"
      params={{ userId: user.id }}
      search={{}}
      className="font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {user.name}
    </Link>
  );
}

function OutcomeBadge({ outcome }: Readonly<{ outcome: AuditOutcome }>) {
  const Icon = OUTCOME_ICONS[outcome];
  return (
    <Badge variant={OUTCOME_VARIANTS[outcome]}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {activityOutcomeLabel(outcome)}
    </Badge>
  );
}

/** A target that is not a user: its kind, and an identity provider's name. */
function ObjectTargetCell({ target }: Readonly<{ target: ActivityObjectTarget }>) {
  return <span>{activityTargetLabel(target, useProviderLabels())}</span>;
}

function DetailsCell({ row }: Readonly<{ row: ActivityRow }>) {
  const parts = activityDetails(row, useProviderLabels());
  if (parts.length === 0) {
    return <span className="text-muted-foreground">{m.admin_activity_none()}</span>;
  }
  return (
    <ul className="flex min-w-48 flex-col gap-0.5 whitespace-normal">
      {parts.map((part) => (
        <li key={part}>{part}</li>
      ))}
    </ul>
  );
}

const helper = createDataTableColumnHelper<ActivityRow>();

/** The columns of the activity table (#36); each owns its header and cell. */
export const activityColumns = helper.columns([
  helper.accessor("occurredAt", {
    id: "occurredAt",
    meta: { label: () => m.admin_activity_col_time() },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <time dateTime={row.original.occurredAt} className="whitespace-nowrap">
        {formatDateTime(row.original.occurredAt)}
      </time>
    ),
  }),
  helper.accessor("action", {
    id: "action",
    meta: { label: () => m.admin_activity_col_action() },
    enableSorting: false,
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{auditActionLabel(row.original.action ?? "")}</span>
    ),
  }),
  helper.accessor("outcome", {
    id: "outcome",
    meta: { label: () => m.admin_activity_col_outcome() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
  }),
  helper.accessor("actor", {
    id: "actor",
    meta: { label: () => m.admin_activity_col_actor() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => {
      const actor = row.original.actor;
      return actor.type === "user" ? (
        <UserCell user={actor} />
      ) : (
        <span className="text-muted-foreground">{activityNonUserActorLabel(actor.type)}</span>
      );
    },
  }),
  helper.accessor("target", {
    id: "target",
    meta: { label: () => m.admin_activity_col_target() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => {
      const target = row.original.target;
      if (!target) return <span className="text-muted-foreground">{m.admin_activity_none()}</span>;
      return target.type === "user" ? (
        <UserCell user={target} />
      ) : (
        <ObjectTargetCell target={target} />
      );
    },
  }),
  helper.display({
    id: "details",
    meta: { label: () => m.admin_activity_col_details() },
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <DetailsCell row={row.original} />,
  }),
]);
