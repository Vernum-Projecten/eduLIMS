// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChartColumnIcon,
  FlaskConicalIcon,
  HistoryIcon,
  ListChecksIcon,
  type LucideIcon,
  SettingsIcon,
  TargetIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { PAGE_TITLE_ID } from "@/components/shell/page-header";
import { SimulationStateBadge } from "@/components/simulations/simulation-state";
import { m } from "@/i18n/messages";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { TeacherSimulationPage } from "@/server/simulations/queries";

/** The pages of a simulation, in the order a teacher works through them (#381). */
const PAGES = [
  {
    to: "/teacher/simulations/$simulationId",
    label: () => m.simulation_nav_overview(),
    icon: ListChecksIcon,
    exact: true,
  },
  {
    to: "/teacher/simulations/$simulationId/labs",
    label: () => m.simulation_nav_labs(),
    icon: FlaskConicalIcon,
    exact: false,
  },
  {
    to: "/teacher/simulations/$simulationId/values",
    label: () => m.simulation_nav_values(),
    icon: TargetIcon,
    exact: true,
  },
  {
    to: "/teacher/simulations/$simulationId/corrections",
    label: () => m.simulation_nav_corrections(),
    icon: HistoryIcon,
    exact: true,
  },
  {
    to: "/teacher/simulations/$simulationId/settings",
    label: () => m.simulation_nav_settings(),
    icon: SettingsIcon,
    exact: true,
  },
] as const satisfies readonly {
  to: string;
  label: () => string;
  icon: LucideIcon;
  exact: boolean;
}[];

/** The index in {@link PAGES} after which the dashboard's link comes: after correct values. */
const DASHBOARD_AFTER = 2;

const TAB =
  "inline-flex items-center gap-1.5 rounded-t-md border-transparent border-b-2 px-3 py-2 text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:border-foreground data-[status=active]:font-semibold data-[status=active]:text-foreground";

/**
 * The navigation between a simulation's pages: links in a list, the current one marked with
 * `aria-current="page"` (the router sets it) and an underline beside its bolder text, so the
 * mark never rests on colour alone (WCAG 1.4.1). The links wrap at 320 px (WCAG 1.4.10).
 */
function SimulationNav({ simulationId, name }: Readonly<{ simulationId: string; name: string }>) {
  return (
    <nav aria-label={m.simulation_nav_label({ name })} className="border-b">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {PAGES.map((page, index) => {
          const Icon = page.icon;
          return (
            <Fragment key={page.to}>
              <li>
                <Link
                  to={page.to}
                  params={{ simulationId }}
                  activeOptions={{ exact: page.exact, includeSearch: false }}
                  className={TAB}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {page.label()}
                </Link>
              </li>
              {/* The live view sits after correct values in the workflow; it is the portal's
                  one dashboard of the running simulation (#386), so it leaves this layout. */}
              {index === DASHBOARD_AFTER && (
                <li>
                  <Link to="/teacher/dashboard" className={TAB}>
                    <ChartColumnIcon aria-hidden="true" className="size-4 shrink-0" />
                    {m.simulation_nav_dashboard()}
                  </Link>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Moves focus to the new page's `h1` after a navigation between the simulation's pages, so a
 * screen reader user hears where they are (WCAG 2.4.3). The first render keeps the shell's own
 * focus handling: a full load starts at the top of the document.
 */
function useFocusTitleOnNavigate(): void {
  const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById(PAGE_TITLE_ID)?.focus();
  }, [pathname]);
}

/**
 * The context above every page of a simulation (D10, #381): its name, its state as a badge with
 * an icon and text (the one place the state shows), its times, and the navigation between its
 * pages in the order a teacher works. The name is not a heading: each page below brings its own
 * frame with its `h1` and its one primary action (#384).
 */
export function SimulationWorkspace({
  page,
  children,
}: Readonly<{ page: TeacherSimulationPage; children: ReactNode }>) {
  useFocusTitleOnNavigate();
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 break-words font-medium text-lg">{page.name}</p>
            <SimulationStateBadge state={page.state} />
          </div>
          <StateTimes page={page} />
        </div>
        <SimulationNav simulationId={page.id} name={page.name} />
      </header>
      {children}
    </div>
  );
}

function StateTimes({ page }: Readonly<{ page: TeacherSimulationPage }>) {
  return (
    <p className="text-muted-foreground text-sm">
      {m.simulation_created()} <time dateTime={page.createdAt}>{formatDate(page.createdAt)}</time>
      {page.startedAt && (
        <>
          {" · "}
          {m.simulations_started_at()}{" "}
          <time dateTime={page.startedAt}>{formatDateTime(page.startedAt)}</time>
        </>
      )}
      {page.finishedAt && (
        <>
          {" · "}
          {m.simulations_finished_at()}{" "}
          <time dateTime={page.finishedAt}>{formatDateTime(page.finishedAt)}</time>
        </>
      )}
    </p>
  );
}
