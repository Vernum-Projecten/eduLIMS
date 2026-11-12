// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BanIcon,
  FlaskConicalIcon,
  GraduationCapIcon,
  type LucideIcon,
  MailIcon,
  MonitorSmartphoneIcon,
  SchoolIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import type { AccountCounts } from "@/server/admin-overview/queries";

/** The classes of a tile's link that covers the card, so the card is one target. */
const COVER_LINK =
  "outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:underline";

function Tile({
  icon: Icon,
  label,
  value,
  link,
}: Readonly<{ icon: LucideIcon; label: string; value: number; link?: ReactNode }>) {
  return (
    <Card
      className={
        link
          ? "relative w-full gap-2 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/50"
          : "w-full gap-2"
      }
    >
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon aria-hidden="true" className="size-4" />
            {link ?? label}
          </h3>
        </CardTitle>
        {link && (
          <CardAction>
            <ArrowRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{formatNumber(value)}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The account tiles of the overview (#36): users per role, active sessions, blocked users, and
 * the active classes and pending class invitations (#28). A tile with a filter of the Users
 * screen links to it with that filter in the URL; the active-classes tile links to the class
 * list filtered on active classes (#37), the invitations tile to the whole list.
 */
export function AccountTiles({ counts }: Readonly<{ counts: AccountCounts }>) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <li className="flex">
        <Tile
          icon={UsersIcon}
          label={m.admin_overview_users()}
          value={counts.users}
          link={
            <Link to="/admin/users" className={COVER_LINK}>
              {m.admin_overview_users()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={GraduationCapIcon}
          label={m.admin_overview_students()}
          value={counts.students}
          link={
            <Link to="/admin/users" search={{ role: ["student"] }} className={COVER_LINK}>
              {m.admin_overview_students()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={FlaskConicalIcon}
          label={m.admin_overview_teachers()}
          value={counts.teachers}
          link={
            <Link to="/admin/users" search={{ role: ["teacher"] }} className={COVER_LINK}>
              {m.admin_overview_teachers()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={ShieldCheckIcon}
          label={m.admin_overview_admins()}
          value={counts.admins}
          link={
            <Link to="/admin/users" search={{ role: ["admin"] }} className={COVER_LINK}>
              {m.admin_overview_admins()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={MonitorSmartphoneIcon}
          label={m.admin_overview_active_sessions()}
          value={counts.activeSessions}
        />
      </li>
      <li className="flex">
        <Tile
          icon={BanIcon}
          label={m.admin_overview_blocked_users()}
          value={counts.blockedUsers}
          link={
            <Link to="/admin/users" search={{ status: ["blocked"] }} className={COVER_LINK}>
              {m.admin_overview_blocked_users()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={SchoolIcon}
          label={m.admin_overview_classes()}
          value={counts.classes}
          link={
            <Link to="/admin/classes" search={{ status: ["active"] }} className={COVER_LINK}>
              {m.admin_overview_classes()}
            </Link>
          }
        />
      </li>
      <li className="flex">
        <Tile
          icon={MailIcon}
          label={m.admin_overview_pending_invitations()}
          value={counts.pendingInvitations}
          link={
            <Link to="/admin/classes" className={COVER_LINK}>
              {m.admin_overview_pending_invitations()}
            </Link>
          }
        />
      </li>
    </ul>
  );
}
