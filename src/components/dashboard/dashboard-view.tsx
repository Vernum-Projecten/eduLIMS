// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { PageFrame } from "@/components/shell/page-frame";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { m } from "@/i18n/messages";
import type { BoardSort } from "@/lib/dashboard";
import type { TeacherDashboard } from "@/lib/dashboard-board";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { DashboardBoard } from "./dashboard-board";
import { DashboardEmpty, DashboardNoColumns } from "./dashboard-empty";
import { type TurnaroundBar, TurnaroundChart } from "./turnaround-chart";

const MINUTE_MS = 60_000;
const CHART_HEADING = "dashboard-chart-heading";

/** Returns how many results the board shows released, over every lab. */
function releasedCount(read: TeacherDashboard): number {
  if (read.kind !== "running") return 0;
  return read.labs.reduce((sum, lab) => sum + lab.summary.released, 0);
}

/**
 * Announces, in a polite live region, how many results were released since the previous read
 * (WCAG 4.1.3); the first read announces nothing, and focus never moves.
 */
function useReleaseAnnouncement(read: TeacherDashboard): string {
  const released = releasedCount(read);
  const previous = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const before = previous.current;
    previous.current = released;
    if (before !== null && released > before) {
      setMessage(m.dashboard_new_releases({ count: formatNumber(released - before) }));
    }
  }, [released]);
  return message;
}

function SortToggle({
  sort,
  onSort,
}: Readonly<{ sort: BoardSort; onSort: (sort: BoardSort) => void }>) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={sort}
      aria-label={m.dashboard_sort_label()}
      onValueChange={(value) => {
        if (value === "board" || value === "name") onSort(value);
      }}
    >
      <ToggleGroupItem value="board">{m.dashboard_sort_board()}</ToggleGroupItem>
      <ToggleGroupItem value="name">{m.dashboard_sort_name()}</ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * The teacher dashboard (D11, #271, #386): the running simulation's board, its one chart, and
 * the time of the read, in the page frame; or the empty state that says why there is none.
 * The query refetches on its interval; the board renders in place, so focus stays where it is.
 */
export function DashboardView({
  read,
  busy,
  sort = "board",
  onSort,
}: Readonly<{
  read: TeacherDashboard;
  busy: boolean;
  sort: BoardSort | undefined;
  onSort: (sort: BoardSort) => void;
}>) {
  const announcement = useReleaseAnnouncement(read);
  if (read.kind !== "running") {
    return (
      <PageFrame title={m.nav_dashboard()} description={m.dashboard_description()}>
        <DashboardEmpty kind={read.kind} />
      </PageFrame>
    );
  }
  const { simulation, columns, labs, readAt } = read;
  const bars: TurnaroundBar[] = labs.flatMap((lab) =>
    lab.summary.medianTurnaroundMs === null
      ? []
      : [
          {
            labId: lab.labId,
            name: lab.name,
            medianMs: lab.summary.medianTurnaroundMs,
            minutes: lab.summary.medianTurnaroundMs / MINUTE_MS,
          },
        ],
  );
  return (
    <PageFrame
      title={m.nav_dashboard()}
      description={m.dashboard_description()}
      secondary={<SortToggle sort={sort} onSort={onSort} />}
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {m.dashboard_running({
            name: simulation.name,
            start: formatDateTime(simulation.startedAt),
          })}
        </p>
        <p className="text-muted-foreground text-sm">
          {m.dashboard_updated({ time: formatDateTime(readAt) })}
        </p>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
      {columns.length === 0 ? (
        <DashboardNoColumns simulationId={simulation.id} />
      ) : labs.length === 0 ? (
        <p className="text-muted-foreground">{m.dashboard_no_labs()}</p>
      ) : (
        <div className="relative" aria-busy={busy || undefined}>
          <UpdatingIndicator active={busy} />
          <DashboardBoard
            name={simulation.name}
            columns={columns}
            labs={labs}
            readAt={readAt}
            sort={sort}
          />
        </div>
      )}
      <section aria-labelledby={CHART_HEADING} className="flex flex-col gap-4">
        <h2 id={CHART_HEADING} className="font-semibold text-lg">
          {m.dashboard_chart_heading()}
        </h2>
        {bars.length === 0 ? (
          <p className="text-muted-foreground">{m.dashboard_chart_none()}</p>
        ) : (
          <TurnaroundChart bars={bars} />
        )}
      </section>
    </PageFrame>
  );
}
