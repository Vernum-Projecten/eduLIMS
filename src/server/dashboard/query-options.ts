// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the teacher dashboard (D11, #271). The board has no writes; it
// refreshes on an interval, so a released result shows without a manual reload.
import { queryOptions } from "@tanstack/react-query";
import { DASHBOARD_REFETCH_MS, STALE_TIME } from "../../lib/query-config.ts";
import { getTeacherDashboardFn } from "./functions.ts";

/** The query keys of the dashboard. */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  /** The board of the running simulation, as the session's teacher sees it. */
  board: () => [...dashboardKeys.all, "board"] as const,
};

/** The board of the running simulation, refetched every {@link DASHBOARD_REFETCH_MS}. */
export function dashboardQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.board(),
    queryFn: () => getTeacherDashboardFn(),
    staleTime: STALE_TIME.dashboard,
    refetchInterval: DASHBOARD_REFETCH_MS,
  });
}
