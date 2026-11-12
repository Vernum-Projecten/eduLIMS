// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ActivityIcon, BanIcon, CircleCheckIcon, CircleXIcon, type LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import { auditActionLabel, auditActorLabel, auditOutcomeLabel } from "@/lib/i18n/user-labels";
import type { OverviewActor, OverviewEvent } from "@/server/admin-overview/queries";

/** The icon of each outcome, always beside its text (WCAG 1.4.1). */
function outcomeIcon(outcome: string): LucideIcon {
  if (outcome === "success") return CircleCheckIcon;
  if (outcome === "refused") return BanIcon;
  return CircleXIcon;
}

function actorText(actor: OverviewActor): string {
  switch (actor.kind) {
    case "user":
      return actor.name === null
        ? m.admin_overview_actor_removed()
        : m.admin_overview_actor_user({ name: actor.name });
    case "system":
      return auditActorLabel("system");
    case "anonymous":
      return auditActorLabel("anonymous");
    default: {
      const unknown: never = actor;
      return unknown;
    }
  }
}

/** The latest activity-log events of the overview (#36, B4), newest first. */
export function RecentActivity({
  events,
  readAt,
}: Readonly<{ events: OverviewEvent[]; readAt: string }>) {
  if (events.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ActivityIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h3>{m.admin_overview_activity_empty_title()}</h3>
          </EmptyTitle>
          <EmptyDescription>{m.admin_overview_activity_empty_body()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col divide-y rounded-xl border">
      {events.map((event) => {
        const Icon = outcomeIcon(event.outcome);
        return (
          <li
            key={event.id}
            className="flex flex-col gap-0.5 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <p className="min-w-0 break-words">
              <span className="font-medium">{auditActionLabel(event.action)}</span>
              <span className="text-muted-foreground"> · {actorText(event.actor)}</span>
            </p>
            <p className="flex shrink-0 items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <Icon aria-hidden="true" className="size-4" />
                {auditOutcomeLabel(event.outcome)}
              </span>
              <time
                dateTime={event.occurredAt}
                title={formatDateTime(event.occurredAt)}
                className="text-muted-foreground tabular-nums"
              >
                {formatRelativeTime(event.occurredAt, readAt)}
              </time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
